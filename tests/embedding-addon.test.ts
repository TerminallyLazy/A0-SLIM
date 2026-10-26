import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmbeddingAddon, probeAddon, type AddonInstaller } from '../src/memory/embedding-addon.js';
import { LocalModel } from '../src/memory/local-model.js';
import { createApp } from '../src/server/app.js';

const fakeInstall: AddonInstaller = async (dir) => {
  await mkdir(join(dir, 'node_modules/@huggingface/transformers'), { recursive: true });
  await writeFile(
    join(dir, 'node_modules/@huggingface/transformers/package.json'),
    '{"version":"4.3.1"}',
  );
};
test('CPU probe cancellation and child failures cannot terminate the service', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-addon-probe-'));
  try {
    await writeFile(
      join(dir, 'worker.mjs'),
      "import {writeFileSync} from 'node:fs'; writeFileSync('started','yes'); setInterval(()=>{},1000);",
    );
    const abort = new AbortController();
    const probe = probeAddon(dir, abort.signal);
    const rejected = assert.rejects(probe, /runtime check stopped/);
    for (let i = 0; i < 100; i++) {
      if (await readFile(join(dir, 'started'), 'utf8').catch(() => '')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    abort.abort();
    await rejected;
    await writeFile(join(dir, 'worker.mjs'), 'process.exit(23);');
    await assert.rejects(probeAddon(dir), /runtime check stopped/);
    await writeFile(join(dir, 'worker.mjs'), 'process.exit(0);');
    await probeAddon(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('optional runtime is absent until requested; interrupted installation retries and tampered recipes are rejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-addon-'));
  let calls = 0,
    fail = true;
  const addon = new EmbeddingAddon(
    dir,
    async (stage, signal) => {
      calls++;
      if (fail) throw new Error('Synthetic interruption');
      await fakeInstall(stage, signal);
    },
    undefined,
    async () => {},
  );
  const model = new LocalModel(dir, addon);
  try {
    assert.equal((await model.status()).runtime.status, 'not-installed');
    await assert.rejects(model.start(), /Install the optional/);
    await assert.rejects(model.infer('local text'), /Install the optional/);
    assert.equal(calls, 0);
    await model.installRuntime();
    await addon.settled();
    assert.equal((await addon.status()).status, 'failed');
    const afterRestart = new EmbeddingAddon(dir);
    assert.equal((await afterRestart.status()).status, 'interrupted');
    fail = false;
    await model.installRuntime();
    await addon.settled();
    assert.equal((await addon.status()).status, 'ready');
    assert.equal((await afterRestart.status()).status, 'ready');
    await writeFile(join(addon.directory, 'worker.mjs'), '// altered');
    await assert.rejects(addon.requireReady(), /Install the optional/);
    assert.equal((await addon.status()).status, 'interrupted');
  } finally {
    await model.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime installation serializes concurrent requests and cancellation; removal preserves model files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-addon-cancel-'));
  let entered!: () => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const addon = new EmbeddingAddon(
    dir,
    async (_stage, signal) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Canceled')), { once: true });
        if (signal.aborted) reject(new Error('Canceled'));
      });
    },
    undefined,
    async () => {},
  );
  const model = new LocalModel(dir, addon);
  try {
    const first = model.installRuntime();
    await assert.rejects(model.installRuntime(), /Stop local embedding work/);
    await first;
    await ready;
    await assert.rejects(model.infer('Synthetic'), /changing/);
    await mkdir(model.directory, { recursive: true });
    await writeFile(join(model.directory, 'retained-model'), 'synthetic weights');
    await addon.cancel();
    assert.equal((await addon.status()).status, 'failed');
    await model.removeRuntime();
    assert.equal((await addon.status()).status, 'not-installed');
    assert.equal(
      await readFile(join(model.directory, 'retained-model'), 'utf8'),
      'synthetic weights',
    );
  } finally {
    await model.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime API requires an explicit download choice and core memory stays available without it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-addon-api-'));
  const origin = 'http://127.0.0.1:4310';
  const { app, store, runtime } = await createApp({
    dataDir: dir,
    origin,
    pairingCode: 'fixture',
    keySource: async () => Buffer.alloc(32, 7),
  });
  let cookie = '';
  const call = (url: string, payload?: unknown) =>
    app.inject({
      method: payload ? 'POST' : 'GET',
      url: `/api/v1${url}`,
      headers: { host: '127.0.0.1:4310', origin, cookie },
      ...(payload ? { payload } : {}),
    });
  try {
    cookie = String((await call('/pair', { code: 'fixture' })).headers['set-cookie']).split(
      ';',
    )[0]!;
    assert.equal((await call('/embeddings/runtime', { action: 'install' })).statusCode, 400);
    assert.equal((await call('/embeddings/local', { action: 'download' })).statusCode, 409);
    assert.equal((await call('/embeddings')).json().local.runtime.status, 'not-installed');
    const project = '7da36202-a63e-4213-8a32-c7c16f019008';
    store.saveProject({ id: project, name: 'Fixture', root: dir });
    const ext = runtime.extensions;
    ext.memory.save(project, { text: 'Sage garden', source: 'Fixture' }, 'fixture');
    const note = ext.memory.list(project)[0]!;
    const namespace = ext.embeddings.namespace(ext.embeddings.connection('local-minilm'));
    store.db
      .prepare('INSERT INTO memory_vectors VALUES (?,?,?,?)')
      .run(namespace, note.id, note.digest, JSON.stringify([1, ...Array(383).fill(0)]));
    // Existing local indexes fall back without deleting notes, vectors or their namespace.
    store.setMeta(`embedding-active:${project}`, 'local-minilm');
    const fallback = await ext.embeddings.search(project, 'sage');
    assert.equal(fallback.mode, 'lexical · semantic search unavailable');
    assert.equal(fallback.notes.length, 1);
    assert.equal((await call('/embeddings/runtime', { action: 'remove' })).statusCode, 200);
    assert.equal(ext.memory.list(project).length, 1);
    assert.equal(
      (store.db.prepare('SELECT count(*) AS n FROM memory_vectors').get() as { n: number }).n,
      1,
    );
    assert.equal(ext.embeddings.state(project).active, 'local-minilm');
    assert.equal(
      (
        await call('/embeddings', {
          name: 'Hosted fixture',
          baseUrl: 'https://example.com/v1',
          model: 'fixture',
          revision: '1',
          dimension: 2,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
