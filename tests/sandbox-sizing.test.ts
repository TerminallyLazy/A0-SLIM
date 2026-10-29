import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { SandboxProof } from '../src/execution/proof.js';
import { defaultSizing } from '../src/execution/sizing.js';
import { parseSizing, sandboxSizing, saveSandboxSizing } from '../src/execution/settings.js';

test('sandbox sizing persists independently of credentials and rejects unsupported or paid-only shapes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-sizing-'));
  const origin = 'http://127.0.0.1:4310';
  const instance = await createApp({
    dataDir: dir,
    origin,
    pairingCode: 'sizing-test',
    keySource: async () => Buffer.alloc(32, 8),
  });
  const { app } = instance;
  try {
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers: { host: '127.0.0.1:4310', origin },
      payload: { code: 'sizing-test' },
    });
    const cookie = paired.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = { host: '127.0.0.1:4310', origin, cookie };
    for (const [provider, defaults] of Object.entries(defaultSizing)) {
      assert.equal(defaults.sessionTimeoutMinutes, 15);
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/sandbox/${provider}/sizing`,
        headers,
      });
      assert.deepEqual(response.json(), defaults);
    }
    const url = '/api/v1/sandbox/vercel/sizing';
    const selected = { sessionTimeoutMinutes: 30, vcpus: 4, memoryMiB: 8192 };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...headers, origin: 'https://evil.test' },
          payload: selected,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url, headers, payload: selected })).statusCode,
      200,
    );
    assert.deepEqual((await app.inject({ method: 'GET', url, headers })).json(), selected);
    const revision = instance.store.meta('sandbox:vercel:revision');
    await app.inject({ method: 'POST', url, headers, payload: selected });
    assert.equal(instance.store.meta('sandbox:vercel:revision'), revision);
    for (const bad of [
      { ...selected, sessionTimeoutMinutes: 46 },
      { ...selected, vcpus: 8 },
      { ...selected, memoryMiB: 2048 },
      { ...selected, sessionTimeoutMinutes: 1.5 },
      { ...selected, token: 'unexpected' },
    ])
      assert.equal(
        (await app.inject({ method: 'POST', url, headers, payload: bad })).statusCode,
        400,
      );
    assert.throws(() => parseSizing('e2b', { ...defaultSizing.e2b, vcpus: 4 }));
    assert.throws(() => parseSizing('modal', { ...defaultSizing.modal, memoryMiB: 32768 }));
    assert.throws(() => parseSizing('daytona', { ...defaultSizing.daytona, vcpus: 16 }));
    assert.deepEqual(sandboxSizing(instance.store, 'vercel'), selected);
    assert.equal(instance.store.meta('sandbox:vercel'), undefined);
    let release!: () => void;
    const work = instance.runtime.vercel.proof.withLease(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    assert.equal(
      (await app.inject({ method: 'POST', url, headers, payload: defaultSizing.vercel }))
        .statusCode,
      409,
    );
    release();
    await work;
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vercel absence review waits for the original session lifetime even after preferences change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-sizing-recovery-'));
  const store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 5));
  try {
    store.receipt({
      id: 'original',
      kind: 'vercel-sandbox-proof',
      cleanup: 'unknown',
      environmentId: 'a0-slim-original',
      startedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      lifetimeMs: 30 * 60_000,
    });
    saveSandboxSizing(store, 'vercel', { ...defaultSizing.vercel, sessionTimeoutMinutes: 1 });
    const proof = new SandboxProof(store, vault);
    await assert.rejects(
      proof.reviewAbsence('original', 'Synthetic absence review after timeout'),
      /recorded session timeout/,
    );
    assert.equal(store.receipts()[0]?.cleanup, 'unknown');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('pairing concurrent loopback instances does not overwrite the other instance cookie', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-pair-ports-'));
  const instances = [];
  const cookies: string[] = [];
  try {
    for (const port of [4310, 4317]) {
      const origin = `http://127.0.0.1:${port}`;
      const instance = await createApp({
        dataDir: join(dir, String(port)),
        origin,
        pairingCode: 'fixture',
        keySource: async () => Buffer.alloc(32, 1),
      });
      instances.push({ ...instance, origin });
      const response = await instance.app.inject({
        method: 'POST',
        url: '/api/v1/pair',
        headers: { host: new URL(origin).host, origin },
        payload: { code: 'fixture' },
      });
      cookies.push(`${response.cookies[0]!.name}=${response.cookies[0]!.value}`);
    }
    assert.notEqual(cookies[0]!.split('=')[0], cookies[1]!.split('=')[0]);
    for (const instance of instances) {
      const response = await instance.app.inject({
        url: '/api/v1/state',
        headers: { host: new URL(instance.origin).host, cookie: cookies.join('; ') },
      });
      assert.equal(response.statusCode, 200);
    }
  } finally {
    for (const instance of instances) await instance.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
