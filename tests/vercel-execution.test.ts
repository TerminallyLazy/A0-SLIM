import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { VercelExecution, vercelExecutionFetch } from '../src/execution/vercel-execution.js';
import { environmentStatus } from '../src/execution/status.js';
import { createApp } from '../src/server/app.js';
import { vercelFixture } from './helpers/vercel-execution.js';
import { startModelFixture } from './helpers/model-server.js';
import { saveSandboxSizing } from '../src/execution/settings.js';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-code-')),
    store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 7));
  const { f, dependencies } = vercelFixture(() => store);
  const runner = new VercelExecution(store, vault, dependencies);
  const projectId = randomUUID(),
    chatId = randomUUID();
  store.saveProject({ id: projectId, name: 'Synthetic Vercel', root: dir });
  store.setMeta('sandbox:vercel', 'configured');
  store.setMeta('sandbox:vercel:revision', 'one');
  store.receipt({
    id: randomUUID(),
    kind: 'vercel-sandbox-proof',
    connectionRevision: 'one',
    status: 'passed',
    cleanup: 'deleted',
  });
  await vault.set('sandbox:vercel', {
    token: 'SECRET-FIXTURE-TOKEN',
    teamId: 'team_fixture',
    projectId: 'prj_fixture',
  });
  runner.authorize(projectId);
  store.saveChat({
    id: chatId,
    title: 'Synthetic Vercel',
    projectId,
    connectionId: randomUUID(),
    model: 'fixture',
    sessionId: 'fixture-session',
    execution: 'vercel',
    executionRevision: 'one',
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  const context = {
    projectId,
    sessionId: 'fixture-session',
    messageId: 'turn-one',
    callId: 'call-one',
  };
  return {
    store,
    vault,
    runner,
    f,
    dependencies,
    projectId,
    chatId,
    context,
    async close() {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
const input = {
  code: "process.stdout.write(require('node:fs').readFileSync(0, 'utf8').toUpperCase())",
  input: 'Vercel without Docker\n',
};

test('Vercel resource changes revoke old grants and the selected lifetime and CPU reach creation', async () => {
  const h = await fixture();
  try {
    const sizing = { sessionTimeoutMinutes: 30, vcpus: 4, memoryMiB: 8192 };
    saveSandboxSizing(h.store, 'vercel', sizing);
    assert.equal(h.runner.readiness().available, false);
    await assert.rejects(h.runner.run(input, h.context), /changed or revoked/);
    const revision = h.runner.revision();
    h.store.receipt({
      id: randomUUID(),
      kind: 'vercel-sandbox-proof',
      connectionRevision: revision,
      status: 'passed',
      cleanup: 'deleted',
    });
    h.runner.authorize(h.projectId);
    await assert.rejects(h.runner.run(input, h.context), /changed or revoked/);
    h.store.saveChat({
      ...h.store.chat(h.chatId),
      id: randomUUID(),
      sessionId: 'sizing-session',
      executionRevision: revision,
    });
    h.f.lifetimeMs = 30 * 60_000;
    h.f.vcpus = 4;
    const receipt = await h.runner.run(input, { ...h.context, sessionId: 'sizing-session' });
    assert.equal(receipt.status, 'passed');
    assert.deepEqual(receipt.sizing, sizing);
    assert.equal(receipt.lifetimeMs, h.f.lifetimeMs);
    assert.equal(receipt.cleanup, 'deleted');
  } finally {
    await h.close();
  }
});

test('Vercel executes bounded Node code without Docker, verifies cleanup and never repeats identical work', async () => {
  const h = await fixture();
  try {
    const receipt = await h.runner.run(input, h.context);
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.cleanup, 'deleted');
    assert.equal(receipt.output, 'VERCEL WITHOUT DOCKER\n');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 1);
    assert.equal(h.f.deletes, 1);
    assert.equal((await h.runner.run(input, h.context)).id, receipt.id);
    const reopenedStore = new Store(h.store.dir);
    const reopened = new VercelExecution(reopenedStore, h.vault, h.dependencies);
    assert.equal(
      (await reopened.run(input, { ...h.context, callId: 'new-runtime-execution-id' })).id,
      receipt.id,
    );
    reopenedStore.close();
    await assert.rejects(h.runner.run({ code: '1' }, h.context), /changed its input/);
    assert.equal(h.f.creates, 1);
    assert.ok(!JSON.stringify(h.store.receipts()).includes('SECRET-FIXTURE'));
    assert.ok(!JSON.stringify(h.store.receipts()).includes(input.code));
  } finally {
    await h.close();
  }
});

test('Vercel permission, connection revision, chat scope, and subordinates cannot fall through to cloud execution', async () => {
  const h = await fixture();
  try {
    h.runner.revoke(h.projectId);
    await assert.rejects(h.runner.run(input, h.context), /Authorize Vercel/);
    h.runner.authorize(h.projectId);
    h.store.setMeta('sandbox:vercel:revision', 'two');
    await assert.rejects(h.runner.run(input, h.context), /Authorize Vercel/);
    h.store.setMeta('sandbox:vercel:revision', 'one');
    h.store.saveChat({ ...h.store.chat(h.chatId), parentChatId: randomUUID() });
    await assert.rejects(h.runner.run(input, h.context), /owning native/);
    assert.equal(h.f.creates, 0);
  } finally {
    await h.close();
  }
});

test('Vercel interrupted creation blocks proofs and chats; reconciliation never replays code or trusts foreign tags', async () => {
  const h = await fixture();
  try {
    h.f.loseCreate = true;
    const receipt = await h.runner.run(input, h.context);
    assert.equal(receipt.cleanup, 'unknown');
    assert.equal(environmentStatus(h.store, {}).vercel!.activity, 'unknown');
    await assert.rejects(
      h.runner.run({ code: '2' }, { ...h.context, callId: 'next' }),
      /unresolved Vercel/,
    );
    await assert.rejects(h.runner.proof.run(), /reconcile/);
    h.f.wrongOwner = true;
    assert.equal((await h.runner.proof.reconcile(String(receipt.id))).cleanup, 'unknown');
    assert.equal(h.f.deletes, 0);
    h.f.wrongOwner = false;
    assert.equal((await h.runner.proof.reconcile(String(receipt.id))).cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 0);
    assert.equal(
      (await h.runner.run(input, { ...h.context, callId: 'recovered-runtime-id' })).id,
      receipt.id,
    );
    assert.equal(h.f.creates, 1);
  } finally {
    await h.close();
  }
});

test('Vercel limits cloud use per turn and across chats, with counters retained after restart', async () => {
  const h = await fixture();
  try {
    for (let i = 0; i < 3; i++)
      await h.runner.run({ code: `console.log(${i})` }, { ...h.context, callId: `call-${i}` });
    await assert.rejects(
      h.runner.run({ code: 'console.log(4)' }, { ...h.context, callId: 'fourth' }),
      /usage limit/,
    );
    for (let i = 0; i < 7; i++)
      h.store.receipt({
        id: randomUUID(),
        kind: 'vercel-execution',
        startedAt: new Date().toISOString(),
        cleanup: 'deleted',
      });
    const reopened = new VercelExecution(h.store, h.vault, h.dependencies);
    await assert.rejects(
      reopened.run({ code: 'console.log(5)' }, { ...h.context, messageId: 'new-turn' }),
      /usage limit/,
    );
    assert.equal(h.f.creates, 3);
  } finally {
    await h.close();
  }
});

for (const mode of ['loseCommand', 'loseStop', 'loseDelete', 'overflow', 'nonzero'] as const)
  test(`Vercel ${mode} retains evidence and does not repeat execution`, async () => {
    const h = await fixture();
    try {
      if (mode !== 'nonzero') h.f[mode] = true;
      const task = mode === 'nonzero' ? { code: 'process.exit(7)' } : input;
      const receipt = await h.runner.run(task, h.context);
      assert.equal(receipt.status, ['loseStop', 'loseDelete'].includes(mode) ? 'passed' : 'failed');
      assert.equal(
        receipt.cleanup,
        mode === 'loseStop' ? 'unknown' : mode === 'loseDelete' ? 'stopped' : 'deleted',
      );
      assert.equal(
        (await h.runner.run(task, { ...h.context, callId: 'replayed-call' })).id,
        receipt.id,
      );
      assert.equal(h.f.creates, 1);
      assert.equal(h.f.commands, 1);
      assert.ok(!JSON.stringify(h.store.receipts()).includes('SECRET-FIXTURE'));
    } finally {
      await h.close();
    }
  });

test('Vercel cancellation still stops and deletes the exact sandbox; the shared lease blocks overlapping proof/recovery', async () => {
  const h = await fixture();
  try {
    h.f.hold = true;
    const controller = new AbortController();
    const run = h.runner.run(input, { ...h.context, signal: controller.signal });
    while (!h.f.commands) await new Promise((r) => setTimeout(r, 2));
    await assert.rejects(h.runner.proof.run(), /already running/);
    await assert.rejects(
      h.runner.proof.reconcile(h.store.receipts()[0]!.id as string),
      /already running/,
    );
    controller.abort();
    const receipt = await run;
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.cleanup, 'deleted');
    assert.equal(h.f.deletes, 1);
  } finally {
    await h.close();
  }
});

test('Vercel transport rejects mutation retries on both API origins, automatic resume, log replay, redirects and oversized responses', async () => {
  let calls = 0;
  const fake: typeof fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'error');
    return new Response('{}', { status: 429 });
  };
  for (const origin of ['https://api.vercel.com', 'https://vercel.com/api']) {
    const transport = vercelExecutionFetch(fake);
    await transport(`${origin}/v3/sandboxes`, { method: 'POST' });
    await assert.rejects(transport(`${origin}/v3/sandboxes`, { method: 'POST' }), /not be retried/);
    await transport(`${origin}/v2/sandboxes/sessions/session/cmd`, { method: 'POST' });
    await assert.rejects(
      transport(`${origin}/v2/sandboxes/sessions/session/cmd`, { method: 'POST' }),
      /not be retried/,
    );
    await assert.rejects(
      transport(`${origin}/v2/sandboxes/name/start`, { method: 'POST' }),
      /resume was blocked/,
    );
    await assert.rejects(
      transport(`${origin}/v2/sandboxes/name?resume=true`),
      /resume was blocked/,
    );
    await assert.rejects(
      transport(`${origin}/v2/sandboxes/sessions/session/cmd/command/logs`),
      /not be replayed/,
    );
    await assert.rejects(
      transport('https://elsewhere.invalid/v3/sandboxes', { method: 'POST' }),
      /destination/,
    );
  }
  assert.equal(calls, 4);
  const huge = vercelExecutionFetch(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(
    (await huge('https://vercel.com/api/v3/sandboxes')).text(),
    /transport limit/,
  );
});

test(
  'native chat selects Vercel without a Docker engine, requires usage consent, and completes a real libfx tool round trip',
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-native-')),
      root = join(dir, 'project');
    await mkdir(root);
    const model = await startModelFixture({ tool: 'run_javascript', toolInput: input });
    let store!: Store;
    const { f, dependencies } = vercelFixture(() => store);
    const instance = await createApp({
      dataDir: join(dir, 'data'),
      origin: 'http://127.0.0.1:4310',
      pairingCode: 'fixture',
      keySource: async () => Buffer.alloc(32, 8),
      vercel: dependencies,
    });
    store = instance.store;
    const { app, vault, runtime } = instance;
    let cookie = '';
    const call = (path: string, payload?: Record<string, unknown>) =>
      app.inject({
        method: payload === undefined ? 'GET' : 'POST',
        url: '/api/v1' + path,
        headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310', cookie },
        payload,
      });
    try {
      runtime.docker.availability = async () => {
        throw new Error('Docker must not be checked to choose Vercel');
      };
      runtime.docker.run = async () => {
        throw new Error('Docker must not run');
      };
      cookie = String((await call('/pair', { code: 'fixture' })).headers['set-cookie']).split(
        ';',
      )[0]!;
      const project = (await call('/projects', { name: 'Vercel fixture', root })).json();
      const connection = (
        await call('/connections', {
          name: 'Fixture',
          kind: 'compatible',
          model: 'fixture',
          baseUrl: model.url,
        })
      ).json();
      const older = (
        await call('/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'Old chat',
        })
      ).json();
      store.setMeta('sandbox:vercel', 'configured');
      store.receipt({
        id: randomUUID(),
        kind: 'vercel-sandbox-proof',
        status: 'passed',
        cleanup: 'deleted',
      });
      await vault.set('sandbox:vercel', {
        token: 'PRIVATE-TEST-TOKEN',
        teamId: 'team_fixture',
        projectId: 'prj_fixture',
      });
      assert.equal(
        (await call(`/projects/${project.id}/execution`, { execution: 'vercel' })).statusCode,
        400,
      );
      assert.equal(
        (
          await call(`/projects/${project.id}/execution`, {
            execution: 'vercel',
            acknowledgeVercelUsage: true,
          })
        ).statusCode,
        200,
      );
      assert.equal(store.chat(older.id).execution, 'none');
      await runtime.vercel.proof.withLease(async () => {
        const update = await call('/sandbox/vercel', {
          teamId: 'team_fixture',
          projectId: 'prj_changed',
        });
        assert.equal(update.statusCode, 409);
      });
      assert.equal(
        (await vault.get<{ projectId: string }>('sandbox:vercel'))?.projectId,
        'prj_fixture',
      );
      const chat = (
        await call('/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'Vercel code',
        })
      ).json();
      assert.equal(chat.execution, 'vercel');
      assert.equal(chat.executionRevision, 'legacy');
      const messageId = randomUUID();
      assert.equal(
        (
          await call(`/chats/${chat.id}/messages`, {
            text: 'Run the synthetic calculation.',
            messageId,
          })
        ).statusCode,
        200,
      );
      const deadline = Date.now() + 8000;
      while (store.chat(chat.id).status === 'running' && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 5));
      assert.equal(store.chat(chat.id).status, 'idle');
      assert.equal(f.creates, 1);
      assert.equal(f.commands, 1);
      const receipt = store.receipts().find((r) => r.kind === 'vercel-execution')!;
      assert.equal(receipt.cleanup, 'deleted');
      assert.equal(receipt.output, 'VERCEL WITHOUT DOCKER\n');
      assert.ok(model.requests[0]?.tools?.some((t) => t.function.name === 'run_javascript'));
      await call(`/chats/${chat.id}/messages`, {
        text: 'Run the synthetic calculation.',
        messageId,
      });
      assert.equal(f.creates, 1);
      await call(`/projects/${project.id}/vercel/revoke`, {});
      assert.throws(() => runtime.vercel.assertAuthorized(store.chat(chat.id)), /Authorize Vercel/);
      assert.equal((await call('/state')).json().vercelExecution.available, true);
    } finally {
      await app.close();
      await model.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('Vercel revocation during preflight or creation prevents command dispatch', async () => {
  const h = await fixture();
  try {
    const preflight = new VercelExecution(h.store, h.vault, {
      ...h.dependencies,
      verify: async (credentials) => {
        h.runner.revoke(h.projectId);
        return credentials;
      },
    });
    await assert.rejects(preflight.run(input, h.context), /Authorize Vercel/);
    assert.equal(h.f.creates, 0);
    h.runner.authorize(h.projectId);
    const canceled = new AbortController();
    const canceledPreflight = new VercelExecution(h.store, h.vault, {
      ...h.dependencies,
      verify: async (credentials) => {
        canceled.abort();
        return credentials;
      },
    });
    await assert.rejects(
      canceledPreflight.run(input, { ...h.context, signal: canceled.signal }),
      /aborted/,
    );
    assert.equal(h.f.creates, 0);
    const duringCreation = new VercelExecution(h.store, h.vault, {
      ...h.dependencies,
      create: async (options) => {
        const sandbox = await h.dependencies.create!(options);
        h.runner.revoke(h.projectId);
        return sandbox;
      },
    });
    const receipt = await duringCreation.run(input, h.context);
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 0);
    assert.equal(h.f.deletes, 1);
  } finally {
    await h.close();
  }
});
