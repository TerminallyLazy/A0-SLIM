import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { McpConnections } from '../src/extensions/mcp.js';
import { NativePlugins, downloadPinned } from '../src/extensions/native-plugins.js';
import { createApp } from '../src/server/app.js';

test('native plugin setup is opt-in, failures settle without enabling tools, and normal state reads never download', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-native-')));
  const store = new Store(dir),
    mcp = new McpConnections(store, new Vault(store, async () => Buffer.alloc(32, 1)));
  let installs = 0;
  const plugins = new NativePlugins(store, mcp, async () => {
    installs++;
    throw new Error('Synthetic download interruption');
  });
  const projectId = randomUUID();
  store.saveProject({ id: projectId, name: 'Fixture', root: dir });
  try {
    assert.equal((await plugins.state()).status, 'not-installed');
    assert.equal((await plugins.projectState(projectId)).binding, undefined);
    assert.equal(installs, 0);
    await assert.rejects(
      plugins.configure(projectId, { database: 'fixture.sqlite', acknowledgeHostExecution: false }),
    );
    await assert.rejects(
      plugins.configure(projectId, { database: 'fixture.sqlite', acknowledgeHostExecution: true }),
      /Install/,
    );
    await Promise.all([plugins.start(), plugins.start(), plugins.start()]);
    await plugins.close();
    assert.equal((await plugins.state()).status, 'failed');
    assert.equal(installs, 1);
    assert.equal(mcp.list(projectId).length, 0);
    assert.equal((await new NativePlugins(store, mcp).state()).status, 'interrupted');
  } finally {
    await plugins.close();
    await mcp.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinned public downloads reject modified and oversized content before extraction', async () => {
  const original = globalThis.fetch;
  const expected = Buffer.from('reviewed public bytes');
  const artifact = {
    url: 'https://example.invalid/fixture',
    sha256: createHash('sha256').update(expected).digest('hex'),
    bytes: expected.length,
  };
  try {
    globalThis.fetch = async () => new Response(expected);
    assert.deepEqual(await downloadPinned(artifact, AbortSignal.timeout(1000)), expected);
    globalThis.fetch = async () => new Response('unreviewed');
    await assert.rejects(downloadPinned(artifact, AbortSignal.timeout(1000)), /checksum/);
    globalThis.fetch = async () => new Response(Buffer.alloc(expected.length + 1));
    await assert.rejects(downloadPinned(artifact, AbortSignal.timeout(1000)), /expected size/);
  } finally {
    globalThis.fetch = original;
  }
});

test('native plugin routes retain pairing, origin, download consent and project authority', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-native-api-')));
  const instance = await createApp({
    dataDir: dir,
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'fixture',
    keySource: async () => Buffer.alloc(32, 3),
  });
  const projectId = randomUUID();
  instance.store.saveProject({ id: projectId, name: 'Fixture', root: dir });
  try {
    assert.equal(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/native-plugins/install',
          headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' },
          payload: { acknowledgeDownload: true },
        })
      ).statusCode,
      401,
    );
    const paired = await instance.app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' },
      payload: { code: 'fixture' },
    });
    const cookie = paired.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = { cookie, host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' };
    assert.equal(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/native-plugins/install',
          headers: { ...headers, origin: 'https://outside.invalid' },
          payload: { acknowledgeDownload: true },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await instance.app.inject({
          method: 'POST',
          url: '/api/v1/native-plugins/install',
          headers,
          payload: {},
        })
      ).statusCode,
      400,
    );
    const state = await instance.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/native-plugins`,
      headers,
    });
    assert.equal(state.statusCode, 200);
    assert.equal(state.json().runtime.status, 'not-installed');
    assert.equal(
      (
        await instance.app.inject({
          method: 'GET',
          url: `/api/v1/projects/${randomUUID()}/native-plugins`,
          headers,
        })
      ).statusCode,
      404,
    );
  } finally {
    await instance.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
