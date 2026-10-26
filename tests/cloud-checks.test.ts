import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import {
  CloudCheck,
  type CloudCheckDriver,
  type CloudIdentity,
} from '../src/execution/cloud-check.js';
import { createE2BDriver, e2bOptions } from '../src/execution/e2b.js';
import { createDaytonaDriver, createDaytonaClient } from '../src/execution/daytona.js';
import { NotFoundError } from 'e2b';
import { DaytonaNotFoundError } from '@daytonaio/sdk';
import { sandboxProviders } from '../ui/sandbox-providers.js';

for (const provider of ['e2b', 'daytona'] as const) {
  test(`${provider} persists intent, blocks replay and reconciles only the original owned resource`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-cloud-'));
    const store = new Store(dir),
      vault = new Vault(store, async () => Buffer.alloc(32, 4));
    await vault.set(`sandbox:${provider}`, { apiKey: 'PRIVATE-FIXTURE-KEY' });
    let resource: CloudIdentity | null = null,
      creates = 0,
      deletes = 0,
      lost = false,
      wrongOwner = false,
      invisible = false,
      lookupFailed = false;
    const driver: CloudCheckDriver = {
      async create(_name, metadata) {
        creates++;
        assert.equal(store.receipts()[0]!.cleanup, 'unknown');
        resource = { id: 'sandbox-fixture', metadata };
        if (lost) throw new Error('PRIVATE-FIXTURE-KEY');
        return resource;
      },
      async get() {
        if (lookupFailed) throw new Error('PRIVATE-FIXTURE-KEY');
        return resource;
      },
      async find() {
        return invisible
          ? []
          : resource
            ? [{ ...resource, metadata: wrongOwner ? {} : resource.metadata }]
            : [];
      },
      async execute() {
        return 'A0 SLIM SYNTHETIC SANDBOX PROOF\n';
      },
      async destroy() {
        deletes++;
        resource = null;
      },
      async close() {},
    };
    try {
      let check = new CloudCheck(provider, store, vault, () => driver);
      const passed = await check.run();
      assert.equal(passed.status, 'passed');
      assert.equal(passed.cleanup, 'deleted');
      lost = true;
      const unknown = await check.run();
      assert.equal(unknown.status, 'failed');
      assert.equal(unknown.cleanup, 'unknown');
      check = new CloudCheck(provider, store, vault, () => driver); // Reopen the coordinator.
      await assert.rejects(check.run(), /Reconcile/);
      await vault.set(`sandbox:${provider}`, { apiKey: 'different-account' });
      assert.match(
        String((await check.reconcile(unknown.id)).reconcileMessage),
        /original API key/,
      );
      await vault.set(`sandbox:${provider}`, { apiKey: 'PRIVATE-FIXTURE-KEY' });
      invisible = true;
      assert.equal((await check.reconcile(unknown.id)).cleanup, 'unknown');
      invisible = false;
      wrongOwner = true;
      assert.equal((await check.reconcile(unknown.id)).cleanup, 'unknown');
      assert.equal(deletes, 1);
      wrongOwner = false;
      lookupFailed = true;
      assert.equal((await check.reconcile(unknown.id)).cleanup, 'unknown');
      lookupFailed = false;
      assert.equal((await check.reconcile(unknown.id)).cleanup, 'deleted');
      assert.equal(creates, 2);
      assert.equal(deletes, 2);
      assert.ok(!JSON.stringify(store.receipts()).includes('PRIVATE-FIXTURE-KEY'));
    } finally {
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('E2B SDK wiring pins credentials, endpoint, network and lifetime; reads do not resume resources', async () => {
  let metadata = {},
    deleted = false;
  const driver = createE2BDriver(
    { apiKey: 'fixture-key' },
    {
      async create(options: any) {
        assert.equal(options.apiKey, 'fixture-key');
        assert.equal(options.apiUrl, 'https://api.e2b.app');
        assert.equal(options.retries, 0);
        assert.equal(options.allowInternetAccess, false);
        assert.equal(options.timeoutMs, 60000);
        assert.equal(options.network.allowPublicTraffic, false);
        assert.deepEqual(options.lifecycle, { onTimeout: 'kill', autoResume: false });
        assert.deepEqual(options.envs, {});
        assert.deepEqual(options.volumeMounts, {});
        metadata = options.metadata;
        return {
          sandboxId: 'fixture-id',
          commands: {
            run: async (_cmd: string, opts: any) => {
              assert.equal(opts.timeoutMs, 10000);
              return { exitCode: 0, stdout: 'fixture-output' };
            },
          },
        } as any;
      },
      async getInfo(_id: string, options: any) {
        assert.equal(options.apiKey, 'fixture-key');
        if (deleted) throw new NotFoundError('gone');
        return { sandboxId: 'fixture-id', metadata } as any;
      },
      list(options: any) {
        assert.deepEqual(options.query.state, ['running', 'paused']);
        return { hasNext: false } as any;
      },
      async kill() {
        deleted = true;
        return true;
      },
    },
  );
  await driver.create('fixture-name', { app: 'a0-slim' });
  assert.equal(await driver.execute('fixture-id'), 'fixture-output');
  assert.deepEqual(await driver.find('fixture-name', {}), []);
  await driver.destroy('fixture-id');
  assert.equal(await driver.get('fixture-id'), null);
});

test('Daytona SDK wiring uses private ephemeral sandboxes and verified deletion', async () => {
  let labels = {},
    deleted = false,
    closed = false;
  const sandbox = {
    id: 'fixture-id',
    get labels() {
      return labels;
    },
    process: {
      executeCommand: async (_cmd: string, _cwd: unknown, env: unknown, timeout: number) => {
        assert.deepEqual(env, {});
        assert.equal(timeout, 10);
        return { exitCode: 0, result: 'fixture-output' };
      },
    },
    delete: async (timeout: number, wait: boolean) => {
      assert.equal(timeout, 15);
      assert.equal(wait, true);
      deleted = true;
    },
  };
  const driver = createDaytonaDriver(
    { apiKey: 'fixture-key' },
    () =>
      ({
        async create(options: any, bounds: any) {
          labels = options.labels;
          assert.equal(bounds.timeout, 30);
          assert.equal(options.networkBlockAll, true);
          assert.equal(options.public, false);
          assert.equal(options.ttlMinutes, 1);
          assert.equal(options.autoDeleteInterval, 0);
          assert.equal(options.ephemeral, true);
          assert.deepEqual(options.secrets, {});
          assert.deepEqual(options.volumes, []);
          return sandbox;
        },
        async get() {
          if (deleted) throw new DaytonaNotFoundError('gone', 404);
          return sandbox;
        },
        async [Symbol.asyncDispose]() {
          closed = true;
        },
      }) as any,
  );
  await driver.create('fixture-name', { app: 'a0-slim' });
  assert.equal(await driver.execute('fixture-id'), 'fixture-output');
  assert.equal((await driver.find('fixture-name', {})).length, 1);
  await driver.destroy('fixture-id');
  assert.equal(await driver.get('fixture-id'), null);
  await driver.close();
  assert.equal(closed, true);
});

test('cloud SDK configuration ignores ambient credentials and blocks inherited endpoint/tracing overrides', async () => {
  const values = {
    E2B_API_URL: 'https://invalid.example',
    E2B_DEBUG: 'true',
    E2B_SANDBOX_URL: 'https://invalid.example',
    DAYTONA_API_URL: 'https://invalid.example',
    DAYTONA_API_KEY: 'ambient-key',
    DAYTONA_OTEL_ENABLED: 'true',
    DAYTONA_EXPERIMENTAL_OTEL_ENABLED: 'true',
  };
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  try {
    Object.assign(process.env, values);
    assert.throws(() => e2bOptions({ apiKey: 'app-key' }), /custom E2B/);
    delete process.env.E2B_SANDBOX_URL;
    const opts = e2bOptions({ apiKey: 'app-key' });
    assert.equal(opts.apiUrl, 'https://api.e2b.app');
    assert.equal(opts.debug, false);
    const client = createDaytonaClient({ apiKey: 'app-key' });
    assert.equal((client as any).apiUrl, 'https://app.daytona.io/api');
    assert.equal((client as any).apiKey, 'app-key');
    assert.equal((client as any).otelSdk, undefined);
    assert.equal((client as any).eventDispatcher, undefined);
    assert.equal(process.env.DAYTONA_OTEL_ENABLED, 'true');
    await client[Symbol.asyncDispose]();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('provider setup links use official sites and vendored logos retain their source hashes', async () => {
  const sources = JSON.parse(await readFile('ui/public/providers/sources.json', 'utf8'));
  for (const provider of sandboxProviders) {
    for (const url of [
      provider.signup,
      provider.signin,
      provider.dashboard,
      provider.credentialsUrl,
      provider.docs,
    ]) {
      const parsed = new URL(url);
      assert.equal(parsed.protocol, 'https:');
      assert.ok(
        [`${provider.id}.com`, `${provider.id}.dev`, `${provider.id}.io`].some(
          (domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
        ),
      );
    }
  }
  for (const [name, source] of Object.entries(sources) as [
    string,
    { sha256: string; file?: string },
  ][]) {
    const svg = await readFile(`ui/public/providers/${source.file ?? `${name}.svg`}`);
    assert.equal(createHash('sha256').update(svg).digest('hex'), source.sha256);
    assert.doesNotMatch(
      svg.toString(),
      /<script|<foreignObject|\bon\w+=|(?:href|src)=["'](?:https?:|\/\/)/i,
    );
  }
});
