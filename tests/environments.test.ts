import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { DockerSandbox, dockerImage } from '../src/execution/docker.js';
import { saveSandboxSizing } from '../src/execution/settings.js';
import { ModalProof, createModalClient } from '../src/execution/modal.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-environments-')),
    store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 3));
  return {
    store,
    vault,
    close: async () => {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('Docker pins local isolation, caches calls and reconciles uncertain creation without repeating it', async () => {
  const f = await fixture();
  saveSandboxSizing(f.store, 'docker', { sessionTimeoutMinutes: 15, vcpus: 2, memoryMiB: 1024 });
  let creates = 0,
    exists = false,
    failCreate = false,
    wrongOwner = false,
    receiptId = '',
    removed = 0;
  const calls: string[][] = [];
  const docker = new DockerSandbox(f.store, async (args) => {
    calls.push(args);
    if (args[0] === 'context') return { stdout: '"unix:///test/docker.sock"', stderr: '' };
    assert.equal(args[1], 'unix:///test/docker.sock');
    let stdout = '';
    if (args[2] === 'create') {
      creates++;
      exists = true;
      receiptId = args[args.indexOf('--name') + 1]!.slice('a0-slim-'.length);
      assert.equal(args[args.indexOf('--network') + 1], 'none');
      assert.ok(args.includes('--read-only'));
      assert.ok(args.includes('ALL'));
      assert.ok(args.includes('no-new-privileges'));
      assert.ok(args.includes(dockerImage));
      assert.equal(args[args.indexOf('--memory') + 1], '1024m');
      assert.equal(args[args.indexOf('--cpus') + 1], '2');
      assert.equal(args[args.indexOf('--user') + 1], '65534:65534');
      assert.ok(!args.some((a) => ['--volume', '--mount', '--privileged', '--env'].includes(a)));
      assert.equal(f.store.receipts()[0]!.cleanup, 'unknown');
      if (failCreate) throw new Error('lost create response');
    } else if (args[2] === 'start') stdout = '42';
    else if (args[3] === 'inspect')
      stdout = args.includes('--format')
        ? JSON.stringify({ Running: false, ExitCode: 0 })
        : JSON.stringify([
            {
              Config: {
                Labels: {
                  'io.a0-slim.operation': wrongOwner ? 'other' : receiptId,
                  'io.a0-slim.host': f.store.meta('host_id'),
                },
              },
            },
          ]);
    else if (args[3] === 'ls') stdout = exists ? 'container-id' : '';
    else if (args[3] === 'rm') {
      removed++;
      exists = false;
    }
    return { stdout, stderr: '' };
  });
  try {
    const result = await docker.run('console.log(42)', '', { callKey: 'call-1' });
    assert.equal(result.status, 'passed');
    assert.equal(result.cleanup, 'removed');
    assert.equal(result.output, '42');
    assert.equal((await docker.run('console.log(42)', '', { callKey: 'call-1' })).id, result.id);
    assert.equal(creates, 1);
    await assert.rejects(docker.run('changed', '', { callKey: 'call-1' }), /changed its input/);
    failCreate = true;
    const unknown = await docker.run('other');
    assert.equal(unknown.cleanup, 'unknown');
    await assert.rejects(docker.run('new call'), /Reconcile/);
    wrongOwner = true;
    assert.equal((await docker.reconcile(String(unknown.id))).cleanup, 'unknown');
    assert.equal(removed, 1);
    wrongOwner = false;
    assert.equal((await docker.reconcile(String(unknown.id))).cleanup, 'removed');
    assert.equal(creates, 2);
  } finally {
    await f.close();
  }
});
test('Docker rejects remote contexts and a nonzero container exit is never success', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const remote = new DockerSandbox(f.store, async () => {
      calls++;
      return { stdout: '"tcp://remote.example:2375"', stderr: '' };
    });
    assert.equal((await remote.run('1')).cleanup, 'not_created');
    assert.equal(calls, 1);
    const local = new DockerSandbox(f.store, async (args) => ({
      stdout:
        args[0] === 'context'
          ? '"unix:///test.sock"'
          : args[3] === 'inspect'
            ? ' {"Running":false,"ExitCode":124}'
            : '',
      stderr: '',
    }));
    const result = await local.run('while(true){}');
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, 124);
    assert.equal(result.cleanup, 'removed');
  } finally {
    await f.close();
  }
});
test('Modal proof bounds isolation, pins recovery scope, and stops the same tagged resource', async () => {
  const f = await fixture();
  const credentials = {
    tokenId: 'synthetic-id',
    tokenSecret: 'DO-NOT-EXPOSE',
    appName: 'fixture-app',
    environment: 'main',
  };
  await f.vault.set('sandbox:modal', credentials);
  saveSandboxSizing(f.store, 'modal', { sessionTimeoutMinutes: 30, vcpus: 2, memoryMiB: 1024 });
  let creates = 0,
    stops = 0,
    closed = 0,
    tags: Record<string, string> = {},
    terminated = false,
    loseCreation = false,
    wrongOwner = false;
  let name = '';
  const resource = {
    sandboxId: 'sb-fixture',
    getTags: async () => (wrongOwner ? {} : tags),
    poll: async () => (terminated ? 0 : null),
    terminate: async () => {
      stops++;
      terminated = true;
      return 0;
    },
    exec: async () => ({
      stdout: { readText: async () => 'A0 SLIM SYNTHETIC MODAL PROOF\n' },
      wait: async () => 0,
    }),
  };
  const proof = new ModalProof(
    f.store,
    f.vault,
    () =>
      ({
        apps: { fromName: async () => ({}) },
        images: { fromRegistry: () => ({}) },
        sandboxes: {
          create: async (_a: any, _i: any, options: any) => {
            creates++;
            terminated = false;
            name = options.name;
            tags = options.tags;
            assert.equal(options.blockNetwork, true);
            assert.equal(options.timeoutMs, 30 * 60_000);
            assert.equal(options.cpu, 1);
            assert.equal(options.memoryMiB, 1024);
            assert.equal(options.cpuLimit, options.cpu);
            assert.equal(options.memoryLimitMiB, options.memoryMiB);
            assert.equal(options.includeOidcIdentityToken, false);
            assert.deepEqual(options.secrets, []);
            assert.deepEqual(options.volumes, {});
            assert.deepEqual(options.encryptedPorts, []);
            assert.equal(f.store.receipts()[0]!.cleanup, 'unknown');
            if (loseCreation) throw new Error('DO-NOT-EXPOSE');
            return resource;
          },
          fromName: async (app: string, requested: string, options: any) => {
            assert.equal(app, 'fixture-app');
            assert.equal(requested, name);
            assert.equal(options.includeTerminated, true);
            return resource;
          },
        },
        close: () => {
          closed++;
        },
      }) as any,
  );
  try {
    const success = await proof.run();
    assert.equal(success.status, 'passed');
    assert.equal(success.cleanup, 'terminated');
    assert.equal(stops, 1);
    loseCreation = true;
    const unknown = await proof.run();
    assert.equal(unknown.cleanup, 'unknown');
    assert.ok(!JSON.stringify(f.store.receipts()).includes('DO-NOT-EXPOSE'));
    await assert.rejects(proof.run(), /Reconcile/);
    await f.vault.set('sandbox:modal', { ...credentials, appName: 'different' });
    assert.match(String((await proof.reconcile(unknown.id)).reconcileMessage), /original Modal/);
    await f.vault.set('sandbox:modal', credentials);
    saveSandboxSizing(f.store, 'modal', { sessionTimeoutMinutes: 30, vcpus: 2, memoryMiB: 1024 });
    wrongOwner = true;
    assert.equal((await proof.reconcile(unknown.id)).cleanup, 'unknown');
    assert.equal(stops, 1);
    wrongOwner = false;
    assert.equal((await proof.reconcile(unknown.id)).cleanup, 'terminated');
    assert.equal(stops, 2);
    assert.equal(creates, 2);
    assert.ok(closed >= 4);
  } finally {
    await f.close();
  }
});
test('Modal explicit token credentials cannot be sent to an inherited custom endpoint', () => {
  const before = process.env.MODAL_SERVER_URL;
  try {
    process.env.MODAL_SERVER_URL = 'https://unexpected.example';
    assert.throws(
      () =>
        createModalClient({
          tokenId: 'synthetic',
          tokenSecret: 'synthetic',
          appName: 'fixture',
          environment: 'main',
        }),
      /custom Modal endpoint/,
    );
  } finally {
    if (before === undefined) delete process.env.MODAL_SERVER_URL;
    else process.env.MODAL_SERVER_URL = before;
  }
});
