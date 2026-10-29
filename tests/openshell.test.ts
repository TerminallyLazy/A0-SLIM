import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { OpenShellProof, openShellOrigin } from '../src/execution/openshell.js';
import type { OpenShellRunner } from '../src/execution/openshell-sdk.js';
import { createApp } from '../src/server/app.js';

const config = {
  gateway: 'https://gateway.example',
  workspace: 'slim-checks',
  image: 'registry.example/shell:1',
  auth: 'oidc',
  token: 'PRIVATE-TEST-TOKEN',
};
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-openshell-'));
  const store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 5));
  const f = {
    installed: true,
    health: 'healthy',
    authentication: 'verified',
    access: 'verified',
    version: '0.1.6',
    principal: 'a'.repeat(64),
    sandbox: null as any,
    lostCreate: false,
    lostDelete: false,
    retainDelete: false,
    wrongDelete: false,
    badReady: false,
    badOutput: false,
    failGet: false,
    creates: 0,
    deletes: 0,
    commands: 0,
    waits: [] as string[],
    calls: [] as string[],
  };
  const runner: OpenShellRunner = async (_dir, request, signal) => {
    signal.throwIfAborted();
    f.calls.push(request.action);
    switch (request.action) {
      case 'inspect':
        return {
          health: f.health,
          authentication: f.authentication,
          access: f.access,
          version: f.version,
          principal: f.principal,
        };
      case 'create':
        f.creates++;
        f.sandbox = {
          id: 'original-id',
          name: request.name,
          workspace: request.config.workspace,
          labels: request.labels,
          phase: 'ready',
        };
        if (f.lostCreate) throw Error(config.token);
        return { sandbox: f.sandbox };
      case 'get':
        if (f.failGet) throw Error(config.token);
        return { sandbox: f.sandbox };
      case 'ready':
        return { sandbox: { ...f.sandbox, id: f.badReady ? 'foreign-id' : f.sandbox.id } };
      case 'execute':
        f.commands++;
        if (f.badOutput) throw Error('output ' + config.token);
        return { outputVerified: true };
      case 'delete':
        f.deletes++;
        if (!f.retainDelete) f.sandbox = null;
        if (f.lostDelete) throw Error(config.token);
        return {
          deletion: {
            outcome: 'accepted',
            sandboxId: f.wrongDelete ? 'foreign-id' : request.sandboxId,
          },
        };
      case 'wait-deleted':
        f.waits.push(request.sandboxId!);
        if (f.sandbox?.id === request.sandboxId) throw Error('timeout');
        return { absent: true };
    }
  };
  let service = new OpenShellProof(store, vault, runner, async () => f.installed);
  await service.save(config);
  return {
    f,
    store,
    vault,
    runner,
    get service() {
      return service;
    },
    reopen() {
      service = new OpenShellProof(store, vault, runner, async () => f.installed);
    },
    async run() {
      await service.check();
      const r = await service.start();
      await service.wait();
      return service.receipts().find((x) => x.id === r.id)!;
    },
    async recover(id: string, resolution?: string) {
      await service.reconcile(id, resolution);
      await service.wait();
      return service.receipts().find((x) => x.id === id)!;
    },
    async close() {
      await service.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('OpenShell distinguishes SDK installation, health, identity, workspace access, version, staleness and execution', async () => {
  const h = await fixture();
  try {
    assert.equal((await h.service.state()).status.connection, 'unchecked');
    assert.equal(h.f.calls.length, 0);
    for (const [field, value] of [
      ['health', 'failed'],
      ['authentication', 'failed'],
      ['access', 'failed'],
      ['version', '0.1.7'],
    ] as const) {
      const old = h.f[field];
      h.f[field] = value;
      await assert.rejects(h.service.check());
      await assert.rejects(h.service.start(), /Check connection/);
      assert.equal((await h.service.state()).status.connection, 'failed');
      h.f[field] = old;
    }
    await h.service.check();
    assert.equal((await h.service.state()).status.connection, 'verified');
    assert.equal(h.f.creates, 0);
    assert.equal((await h.service.state()).status.activeSandbox, null);
    const check = h.store.records<any>('openshell-check')[0];
    check.checkedAt = new Date(Date.now() - 601_000).toISOString();
    h.store.record('openshell-check', check);
    assert.equal((await h.service.state()).status.connection, 'stale');
    await assert.rejects(h.service.start());
    h.f.installed = false;
    assert.equal((await h.service.state()).status.connection, 'sdk_missing');
  } finally {
    await h.close();
  }
});

test('OpenShell success records intent before effects, verifies expected ID absence, and never exposes secrets', async () => {
  const h = await fixture();
  try {
    const r = await h.run();
    assert.equal(r.status, 'passed');
    assert.equal(r.cleanup, 'deleted');
    assert.ok(r.createIntentAt && r.executeIntentAt && r.deleteIntentAt && r.cleanupVerifiedAt);
    assert.equal(h.f.commands, 1);
    assert.equal(h.f.deletes, 1);
    assert.deepEqual(h.f.waits, ['original-id']);
    assert.ok(!JSON.stringify(await h.service.state()).includes(config.token));
    assert.ok(
      !JSON.stringify(h.store.db.prepare('SELECT * FROM vault').all()).includes(config.token),
    );
    await h.service.save({ ...config, token: '' });
    assert.equal((await h.service.state()).status.connection, 'verified');
    await h.service.save({ ...config, image: 'other:1', token: '' });
    assert.equal((await h.service.state()).status.connection, 'changed');
    await assert.rejects(h.service.start());
    await assert.rejects(
      h.service.save({ ...config, gateway: 'https://other.example', token: '' }),
      /credentials/,
    );
  } finally {
    await h.close();
  }
});

test('OpenShell lost create survives restart, blocks new creation and recovers only ownership-matched resources', async () => {
  const h = await fixture();
  try {
    h.f.lostCreate = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    assert.equal(r.sandboxId, undefined);
    assert.equal(h.f.commands, 0);
    h.reopen();
    await assert.rejects(h.service.start(), /previous OpenShell outcome/);
    const original = h.f.sandbox;
    h.f.sandbox = null;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    h.f.sandbox = { ...original, labels: { 'slim-host': 'foreign' } };
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.deletes, 0);
    h.f.sandbox = original;
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 0);
    assert.equal(h.f.deletes, 1);
  } finally {
    await h.close();
  }
});

test('OpenShell failed lookups and lost deletion retain holds; recovery does not replay delete or execution', async () => {
  const h = await fixture();
  try {
    h.f.lostDelete = true;
    h.f.retainDelete = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    h.f.failGet = true;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    h.f.failGet = false;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.deletes, 1);
    assert.equal(h.f.commands, 1);
    h.f.sandbox = { ...h.f.sandbox, id: 'replacement-id', labels: {} };
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    assert.equal(h.f.sandbox.id, 'replacement-id');
    assert.equal(h.f.deletes, 1);
    assert.deepEqual(h.f.waits, ['original-id', 'original-id']);
    assert.ok(!JSON.stringify(await h.service.state()).includes(config.token));
  } finally {
    await h.close();
  }
});

test('OpenShell mismatched delete IDs cannot clear automatically; manual absence review preserves failure', async () => {
  const h = await fixture();
  try {
    h.f.wrongDelete = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    assert.equal(r.identityConflict, true);
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.waits.length, 0);
    const reviewed = await h.recover(
      r.id,
      'Operator inspected original gateway and confirmed both resource IDs absent.',
    );
    assert.equal(reviewed.cleanup, 'reviewed_absent');
    assert.equal(reviewed.status, 'failed');
  } finally {
    await h.close();
  }
});

test('OpenShell scope and identity bind recovery; token rotation for the same principal works', async () => {
  const h = await fixture();
  try {
    h.f.lostCreate = true;
    const r = await h.run();
    await h.service.save({ ...config, workspace: 'another' });
    await assert.rejects(h.service.reconcile(r.id), /original gateway/);
    await h.service.save({ ...config, token: 'rotated-token' });
    h.f.principal = 'b'.repeat(64);
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.deletes, 0);
    h.f.principal = 'a'.repeat(64);
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
  } finally {
    await h.close();
  }
});

test('OpenShell refuses changed ready identities and bad output; cleanup remains independent from execution evidence', async () => {
  for (const field of ['badReady', 'badOutput'] as const) {
    const h = await fixture();
    try {
      h.f[field] = true;
      const r = await h.run();
      assert.equal(r.status, 'failed');
      assert.equal(r.cleanup, 'deleted');
      assert.equal(r.outputVerified, undefined);
      assert.equal(h.f.commands, field === 'badReady' ? 0 : 1);
    } finally {
      await h.close();
    }
  }
});

test('OpenShell validates TLS origins and does not accept arbitrary insecure transport options', async () => {
  for (const input of [
    'http://localhost:17670',
    'https://user:secret@example.com',
    'https://example.com/path',
    'https://example.com/?token=secret',
  ])
    assert.throws(() => openShellOrigin(input));
  const h = await fixture();
  try {
    await assert.rejects(h.service.save({ ...config, insecureSkipVerify: true }));
    await assert.rejects(
      h.service.save({ ...config, auth: 'mtls', clientCert: 'bad', clientKey: 'bad' }),
      /PEM/,
    );
  } finally {
    await h.close();
  }
});

test('OpenShell shutdown leaves persisted creation hold and concurrent operations are rejected', async () => {
  const h = await fixture();
  try {
    let started!: () => void;
    const creating = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked: OpenShellRunner = async (d, request, signal) => {
      if (request.action !== 'create') return h.runner(d, request, signal);
      assert.equal(h.store.receipts().at(-1)?.cleanup, 'unknown');
      started();
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
      );
    };
    const service = new OpenShellProof(h.store, h.vault, blocked, async () => true);
    await service.check();
    const r = await service.start();
    await creating;
    await assert.rejects(service.save(config), /already in progress/);
    await assert.rejects(service.start(), /already in progress/);
    await service.close();
    h.reopen();
    assert.equal(h.service.receipts().find((x) => x.id === r.id)!.cleanup, 'unknown');
  } finally {
    await h.close();
  }
});

test('OpenShell API requires pairing, usage and dedicated workspace acknowledgments', async () => {
  const h = await fixture(),
    dir = await mkdtemp(join(tmpdir(), 'slim-openshell-api-'));
  const { app } = await createApp({
    dataDir: dir,
    origin: 'http://127.0.0.1:4998',
    pairingCode: 'test-pair',
    keySource: async () => Buffer.alloc(32, 5),
    openshell: { runner: h.runner, installed: async () => true },
  });
  try {
    const headers = {
      host: '127.0.0.1:4998',
      origin: 'http://127.0.0.1:4998',
      'content-type': 'application/json',
    };
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/sandbox/openshell', headers })).statusCode,
      401,
    );
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers,
      payload: JSON.stringify({ code: 'test-pair' }),
    });
    const authenticated = {
      ...headers,
      cookie: paired.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    };
    const post = (path: string, body: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/sandbox/openshell' + path,
        headers: authenticated,
        payload: JSON.stringify(body),
      });
    assert.equal((await post('', config)).statusCode, 200);
    assert.equal((await post('/check', {})).statusCode, 200);
    assert.equal((await post('/proof', {})).statusCode, 400);
    assert.equal((await post('/proof', { acknowledgeUsage: true })).statusCode, 400);
    assert.equal(h.f.creates, 0);
    assert.equal(
      (await post('/proof', { acknowledgeUsage: true, acknowledgeDedicatedWorkspace: true }))
        .statusCode,
      202,
    );
  } finally {
    await app.close();
    await h.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenShell SDK dispatch checks public health before protected identity, scopes workspace and bounds streams', async () => {
  const { dispatch } = await import(pathToFileURL(resolve('addons/openshell/worker.mjs')).href);
  let calls: string[] = [];
  const client = {
    async health() {
      calls.push('health');
      return { status: 'healthy', version: '0.1.6' };
    },
    raw: {
      async getCurrentUser() {
        calls.push('identity');
        return { subject: 'fixture-user', identityProvider: 'fixture' };
      },
      async listSandboxes(r: any) {
        assert.deepEqual(r.workspaceScope, {
          selection: { case: 'workspace', value: config.workspace },
        });
        calls.push('access');
        return {};
      },
    },
    sandbox: {
      async get() {
        return {
          id: 'id',
          name: 'name',
          workspace: config.workspace,
          labels: { 'slim-host': 'host' },
        };
      },
      async *execStream(
        _name: string,
        _command: string[],
        options: any,
      ): AsyncGenerator<{ stream: string; data: Buffer }> {
        assert.equal(options.noLoginShell, true);
        assert.equal(options.timeoutSecs, 30);
        yield { stream: 'stdout', data: Buffer.alloc(16_385) };
        throw Error('must stop before here');
      },
    },
  };
  const r = { action: 'inspect', config };
  const check = await dispatch(client, r);
  assert.deepEqual(calls, ['health', 'identity', 'access']);
  assert.equal(check.access, 'verified');
  calls = [];
  client.raw.getCurrentUser = async () => {
    calls.push('identity');
    throw { code: 16 };
  };
  assert.equal((await dispatch(client, r)).authentication, 'failed');
  assert.deepEqual(calls, ['health', 'identity']);
  await assert.rejects(
    dispatch(client, {
      action: 'execute',
      config,
      name: 'name',
      sandboxId: 'id',
      labels: { 'slim-host': 'host' },
    }),
    /output_limit/,
  );
  client.sandbox.execStream = async function* () {
    yield { stream: 'stdout', data: Buffer.from('A0 SLIM OpenShell synthetic check\n') };
  };
  await assert.rejects(
    dispatch(client, {
      action: 'execute',
      config,
      name: 'name',
      sandboxId: 'id',
      labels: { 'slim-host': 'host' },
    }),
    /output/,
  );
});

test('OpenShell shutdown waits for preflight and prevents creation after an asynchronous SDK check', async () => {
  const h = await fixture();
  try {
    await h.service.check();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const service = new OpenShellProof(h.store, h.vault, h.runner, async () => {
      entered();
      await gate;
      return true;
    });
    const starting = service.start();
    await started;
    const closing = service.close();
    release();
    await assert.rejects(starting, /shutting down/);
    await closing;
    assert.equal(h.f.creates, 0);
    assert.equal(service.receipts().length, 0);
  } finally {
    await h.close();
  }
});
