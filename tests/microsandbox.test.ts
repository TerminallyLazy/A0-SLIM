import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Microsandbox, microProofCode } from '../src/execution/microsandbox.js';
import {
  MicrosandboxAddon,
  microsandboxSource,
  type MicroRunner,
} from '../src/execution/microsandbox-addon.js';
import { defaultSizing } from '../src/execution/sizing.js';
import { createApp } from '../src/server/app.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-micro-')),
    store = new Store(dir);
  const f = {
    sizing: { ...defaultSizing.microsandbox },
    runs: 0,
    cleanups: 0,
    lost: false,
    absent: false,
    badCleanup: false,
    failInstall: false,
    cancel: false,
  };
  const runner: MicroRunner = async (_dir, _home, r, signal, created) => {
    if (r.action === 'prepare' || r.action === 'probe')
      return { version: '0.7.11', imageReady: true, runtimeId: 'fixture-runtime' };
    if (r.action === 'cleanup') {
      f.cleanups++;
      if (f.badCleanup) throw Error('Identity mismatch; no deletion.');
      assert.equal(r.runtimeId, 'fixture-runtime');
      return { absent: true, observedId: f.absent ? null : 'local:1' };
    }
    f.runs++;
    assert.deepEqual(r.sizing, f.sizing);
    assert.equal(store.receipts()[0]?.cleanup, 'unknown');
    if (f.lost) throw Error('lost creation reply');
    created!('local:1');
    assert.equal(store.receipts()[0]?.sandboxId, 'local:1');
    if (f.cancel)
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(Error('canceled')), { once: true }),
      );
    return {
      output: r.code === microProofCode ? 'A0 SLIM MICROSANDBOX CHECK\n' : '42\n',
      stderr: '',
      exitCode: 0,
    };
  };
  const addon = new MicrosandboxAddon(dir, runner, async (stage) => {
    if (f.failInstall) throw Error('offline');
    await mkdir(join(stage, 'node_modules/microsandbox'), { recursive: true });
    await writeFile(join(stage, 'node_modules/microsandbox/package.json'), '{"version":"0.7.11"}');
  });
  const micro = new Microsandbox(store, addon);
  const projectId = randomUUID(),
    chatId = randomUUID();
  store.saveProject({ id: projectId, name: 'Fixture', root: dir, execution: 'microsandbox' });
  store.saveChat({
    id: chatId,
    projectId,
    title: 'Fixture',
    connectionId: randomUUID(),
    model: 'fixture',
    execution: 'microsandbox',
    executionRevision: (await micro.state()).revision,
    sessionId: 'session',
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  const context = { projectId, sessionId: 'session', messageId: 'turn', callId: 'call' };
  return {
    dir,
    store,
    f,
    addon,
    micro,
    context,
    chatId,
    install: async () => {
      await micro.install();
      await addon.settled();
    },
    close: async () => {
      await micro.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('optional Microsandbox setup, runtime readiness, proof and restart evidence are distinct', async () => {
  const h = await fixture();
  try {
    assert.equal((await h.micro.state()).runtime.status, 'not-installed');
    await assert.rejects(h.micro.run({ code: 'x' }, h.context), /Install/);
    h.f.failInstall = true;
    await h.install();
    assert.equal((await h.micro.state()).runtime.status, 'failed');
    h.f.failInstall = false;
    await h.install();
    assert.equal((await h.micro.state()).available, false);
    await h.micro.check();
    assert.equal((await h.micro.state()).available, false);
    const proof = await h.micro.proof();
    assert.equal(proof.status, 'passed');
    assert.equal(proof.cleanup, 'deleted');
    assert.equal((await h.micro.state()).available, true);
    const reopened = new Microsandbox(h.store, h.addon);
    assert.equal((await reopened.state()).available, false);
    await reopened.check();
    assert.equal((await reopened.state()).available, true);
    await h.micro.remove();
    assert.equal((await h.micro.state()).available, false);
    assert.equal(h.store.receipts().length, 1);
  } finally {
    await h.close();
  }
});

test('Microsandbox receipts prevent replay across call IDs and restarts, and bind native chat scope', async () => {
  const h = await fixture();
  try {
    await h.install();
    await h.micro.proof();
    const r = await h.micro.run({ code: 'console.log(42)' }, h.context);
    assert.equal(r.output, '42\n');
    assert.equal(r.cleanup, 'deleted');
    assert.equal(
      (await h.micro.run({ code: 'console.log(42)' }, { ...h.context, callId: 'new' })).id,
      r.id,
    );
    const restarted = new Microsandbox(h.store, h.addon);
    assert.equal((await restarted.run({ code: 'console.log(42)' }, h.context)).id, r.id);
    assert.equal(h.f.runs, 2);
    await assert.rejects(h.micro.run({ code: 'changed' }, h.context), /changed/);
    h.store.saveChat({ ...h.store.chat(h.chatId), parentChatId: randomUUID() });
    await assert.rejects(h.micro.run({ code: 'x' }, h.context), /owning native/);
    assert.ok(!JSON.stringify(h.store.receipts()).includes('console.log'));
  } finally {
    await h.close();
  }
});

test('lost creation and cleanup failures hold execution, installation and removal until identity recovery', async () => {
  const h = await fixture();
  try {
    await h.install();
    h.f.lost = true;
    h.f.absent = true;
    const r = await h.micro.proof();
    assert.equal(r.cleanup, 'unknown');
    await assert.rejects(h.micro.proof(), /Reconcile/);
    await assert.rejects(h.micro.install(), /uncertain/);
    await assert.rejects(h.micro.remove(), /uncertain/);
    assert.equal((await h.micro.reconcile(r.id)).cleanup, 'unknown');
    h.f.absent = false;
    h.f.badCleanup = true;
    assert.equal((await h.micro.reconcile(r.id)).cleanup, 'unknown');
    h.f.badCleanup = false;
    assert.equal((await h.micro.reconcile(r.id)).cleanup, 'deleted');
    assert.equal(h.f.runs, 1); // Recovery never replays the command or creates a VM.
  } finally {
    await h.close();
  }
});

test('cancellation waits for worker exit and runs independent cleanup; interrupted receipt remains held', async () => {
  const h = await fixture();
  try {
    await h.install();
    await h.micro.proof();
    h.f.cancel = true;
    const abort = new AbortController();
    const job = h.micro.run({ code: 'wait' }, { ...h.context, signal: abort.signal });
    while (h.f.runs < 2) await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(h.micro.check(), /already in progress/);
    await assert.rejects(
      h.micro.saveSizing({ sessionTimeoutMinutes: 30, vcpus: 2, memoryMiB: 1024 }),
      /already in progress/,
    );
    abort.abort();
    const r = await job;
    assert.equal(r.status, 'failed');
    assert.equal(r.cleanup, 'deleted');
    h.store.receipt({ ...r, id: randomUUID(), status: 'pending', cleanup: 'unknown' });
    const restarted = new Microsandbox(h.store, h.addon);
    assert.equal((await restarted.state()).activity, 'unknown');
    assert.equal(h.store.receipts()[0]?.status, 'interrupted');
  } finally {
    await h.close();
  }
});

test('Microsandbox API requires pairing, explicit setup consent and a passed check before selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-micro-api-'));
  const { app, store } = await createApp({
    dataDir: dir,
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'fixture',
    keySource: async () => Buffer.alloc(32, 1),
  });
  try {
    const headers = { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' };
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/sandbox/microsandbox', headers }))
        .statusCode,
      401,
    );
    const pair = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers,
      payload: { code: 'fixture' },
    });
    const authenticated = { ...headers, cookie: String(pair.headers['set-cookie']).split(';')[0]! };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/sandbox/microsandbox/install',
          headers: authenticated,
          payload: {},
        })
      ).statusCode,
      400,
    );
    const projectId = randomUUID();
    store.saveProject({ id: projectId, name: 'fixture', root: '/tmp' });
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/projects/${projectId}/execution`,
          headers: authenticated,
          payload: { execution: 'microsandbox' },
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a source update preserves recovery through the intact installed worker without allowing new execution', async () => {
  const h = await fixture();
  try {
    await h.install();
    const proof = await h.micro.proof();
    h.store.receipt({ ...proof, cleanup: 'unknown' });
    const source = join(h.dir, 'updated-recipe');
    await mkdir(source);
    for (const name of ['package.json', 'npm-shrinkwrap.json', 'worker.mjs', 'runtime.json'])
      await copyFile(join(microsandboxSource, name), join(source, name));
    await writeFile(join(source, 'worker.mjs'), '// synthetic updated worker');
    const updated = new MicrosandboxAddon(h.dir, h.addon.runner, undefined, source);
    const next = new Microsandbox(h.store, updated);
    assert.equal((await updated.state()).status, 'update-required');
    assert.equal((await updated.state()).recoveryAvailable, true);
    await assert.rejects(updated.requireInstalled(), /Install/);
    await assert.rejects(next.install(), /uncertain/);
    assert.equal((await next.reconcile(proof.id)).cleanup, 'deleted');
    assert.equal(h.f.runs, 1);
  } finally {
    await h.close();
  }
});

test('absence review requires elapsed lifetime, records evidence and preserves failed execution', async () => {
  const h = await fixture();
  try {
    await h.install();
    h.f.lost = true;
    h.f.absent = true;
    const r = await h.micro.proof();
    await assert.rejects(
      h.micro.reviewAbsence(r.id, 'Inspected exact resource name.'),
      /lifetime limits/,
    );
    h.store.receipt({
      ...r,
      startedAt: new Date(Date.now() - (r.lifetimeMs! + 61_000)).toISOString(),
    });
    const reviewed = await h.micro.reviewAbsence(
      r.id,
      'Inspected exact resource name and stopped creator.',
    );
    assert.equal(reviewed.status, 'failed');
    assert.equal(reviewed.cleanup, 'deleted');
    assert.equal(h.store.records('microsandbox-absence-review').length, 1);
    assert.equal(h.f.runs, 1);
  } finally {
    await h.close();
  }
});

test('Microsandbox settings reach the worker and require a fresh check and new chat revision', async () => {
  const h = await fixture();
  try {
    await h.install();
    await h.micro.proof();
    const before = (await h.micro.state()).revision;
    h.f.sizing = { sessionTimeoutMinutes: 30, vcpus: 2, memoryMiB: 1024 };
    await h.micro.saveSizing(h.f.sizing);
    assert.notEqual((await h.micro.state()).revision, before);
    assert.equal((await h.micro.state()).available, false);
    await h.micro.proof();
    await assert.rejects(h.micro.run({ code: 'x' }, h.context), /changed|new chat/i);
    h.store.saveChat({
      ...h.store.chat(h.chatId),
      executionRevision: (await h.micro.state()).revision,
    });
    const receipt = await h.micro.run({ code: 'console.log(42)' }, h.context);
    assert.deepEqual(receipt.sizing, h.f.sizing);
    assert.equal(receipt.lifetimeMs, 30 * 60_000);
    assert.equal(receipt.cleanup, 'deleted');
  } finally {
    await h.close();
  }
});
