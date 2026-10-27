import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { Bash } from '../src/tools/bash.js';
import { DockerSandbox } from '../src/execution/docker.js';
import { VercelExecution } from '../src/execution/vercel-execution.js';
import { Microsandbox } from '../src/execution/microsandbox.js';
import { Vault } from '../src/providers/vault.js';
import { vercelFixture } from './helpers/vercel-execution.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'slim-bash-'));
  const store = new Store(join(root, 'data')),
    projectId = randomUUID(),
    chatId = randomUUID();
  const vault = new Vault(store, async () => Buffer.alloc(32, 7));
  const { f, dependencies } = vercelFixture(() => store);
  const adapters = {
    docker: new DockerSandbox(store),
    vercel: new VercelExecution(store, vault, dependencies),
    microsandbox: new Microsandbox(store),
  };
  const bash = new Bash(store, adapters);
  const work = join(root, "work space's");
  await mkdir(work);
  store.saveProject({ id: projectId, name: 'Bash fixture', root: work });
  await bash.authorize(projectId);
  store.saveChat({
    id: chatId,
    projectId,
    connectionId: randomUUID(),
    model: 'fixture',
    title: 'Bash fixture',
    status: 'idle',
    createdAt: new Date().toISOString(),
    sessionId: 'session',
    bashVersion: 1,
    hostBashRevision: store.project(projectId).hostBashGrant?.revision,
  });
  const context = () => ({
    projectId,
    sessionId: 'session',
    messageId: randomUUID(),
    callId: randomUUID(),
  });
  const hostRun = (value: Record<string, unknown>, ctx: Parameters<Bash['run']>[1]) =>
    bash.run({ target: 'host', ...value }, ctx);
  return {
    hostRun,
    root,
    work,
    store,
    bash,
    adapters,
    f,
    vault,
    projectId,
    chatId,
    context,
    async close() {
      await bash.close();
      await adapters.microsandbox.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('Bash supports real scripts, stdin, pipefail, literal paths and clean environment', async () => {
  const h = await fixture();
  const prior = process.env.BASH_ENV;
  process.env.BASH_ENV = '/must-not-load';
  process.env.SLIM_BASH_SECRET = 'private';
  try {
    await assert.rejects(h.bash.run({ command: 'true' }, h.context()), /no sandbox/);
    const r = await h.hostRun(
      {
        command:
          'items=(paper garden); printf \'%s\\n\' "${items[*]}"; cat; printf \'warning\' >&2; test -z "$SLIM_BASH_SECRET$BASH_ENV"',
        input: 'stdin\n',
      },
      h.context(),
    );
    assert.equal(r.status, 'passed');
    assert.equal(r.stdout, 'paper garden\nstdin\n');
    assert.equal(r.stderr, 'warning');
    assert.equal(r.exitCode, 0);
    assert.equal(r.cwd, await import('node:fs/promises').then((fs) => fs.realpath(h.work)));
    const failed = await h.hostRun({ command: 'false | cat' }, h.context());
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.status, 'failed');
    const heredoc = await h.hostRun(
      { command: "cat <<'NOTE'\nliteral $HOME `date`\nNOTE" },
      h.context(),
    );
    assert.equal(heredoc.stdout, 'literal $HOME `date`\n');
    await mkdir(join(h.work, 'sub'));
    await h.hostRun({ command: 'pwd', cwd: 'sub' }, h.context());
    assert.match(String((await h.hostRun({ command: 'pwd' }, h.context())).stdout), /sub\n$/);
    assert.ok(!JSON.stringify(h.store.receipts()).includes('SLIM_BASH_SECRET'));
  } finally {
    if (prior === undefined) delete process.env.BASH_ENV;
    else process.env.BASH_ENV = prior;
    delete process.env.SLIM_BASH_SECRET;
    await h.close();
  }
});

test('Bash stops timed-out process groups, caps output, cancels and revokes active host execution', async () => {
  const h = await fixture();
  try {
    const r = await h.hostRun(
      { command: 'sleep 1; touch must-not-exist', timeout_ms: 100 },
      h.context(),
    );
    assert.equal(r.timedOut, true);
    const over = await h.hostRun({ command: 'yes output' }, h.context());
    assert.equal(over.truncated, true);
    assert.ok(
      Buffer.byteLength(String(over.stdout)) + Buffer.byteLength(String(over.stderr)) <= 32768,
    );
    const abort = new AbortController();
    const work = h.hostRun(
      { command: 'sleep 20; touch also-must-not-exist' },
      { ...h.context(), signal: abort.signal },
    );
    await new Promise((r) => setTimeout(r, 100));
    abort.abort();
    assert.equal((await work).cancelled, true);
    const pending = h.hostRun({ command: 'sleep 20' }, h.context());
    await new Promise((r) => setTimeout(r, 100));
    await h.bash.revoke(h.projectId);
    assert.equal((await pending).cancelled, true);
    await assert.rejects(h.hostRun({ command: 'true' }, h.context()), /disabled/);
    await h.bash.authorize(h.projectId);
    await assert.rejects(h.hostRun({ command: 'true' }, h.context()), /grant changed/);
    await new Promise((r) => setTimeout(r, 1000));
    await assert.rejects(readFile(join(h.work, 'must-not-exist')));
    await assert.rejects(readFile(join(h.work, 'also-must-not-exist')));
  } finally {
    await h.close();
  }
});

test('Bash caches effects across restart and changed runtime IDs, retains unknown outcomes and checks scope', async () => {
  const h = await fixture();
  try {
    const context = h.context(),
      input = { target: 'host' as const, command: 'echo once >> count; cat count' };
    const r = await h.hostRun(input, context);
    const reopened = new Bash(h.store, h.adapters);
    assert.equal((await reopened.run(input, { ...context, callId: randomUUID() })).id, r.id);
    assert.equal(await readFile(join(h.work, 'count'), 'utf8'), 'once\n');
    await assert.rejects(
      reopened.run({ target: 'host', command: 'echo changed' }, context),
      /changed/,
    );
    h.store.receipt({
      id: randomUUID(),
      kind: 'bash',
      status: 'running',
      target: 'host',
      projectId: h.projectId,
      chatId: h.chatId,
    });
    const recovered = new Bash(h.store, h.adapters),
      unknown = recovered.receipts().find((r) => r.status === 'unknown')!;
    await assert.rejects(
      recovered.run({ target: 'host', command: 'true' }, h.context()),
      /unknown/,
    );
    recovered.review(unknown.id, 'Inspected the fixture; no process remains.');
    assert.equal(h.store.receipts().find((r) => r.id === unknown.id)?.status, 'unknown');
    assert.equal(
      (await recovered.run({ target: 'host', command: 'true' }, h.context())).status,
      'passed',
    );
    for (const changes of [
      { parentChatId: randomUUID() },
      { backend: 'acp' as const },
      { bashVersion: undefined },
    ]) {
      const chat = h.store.chat(h.chatId);
      h.store.saveChat({ ...chat, ...changes });
      await assert.rejects(
        recovered.run({ target: 'host', command: 'true' }, h.context()),
        /owning/,
      );
      h.store.saveChat(chat);
    }
  } finally {
    await h.close();
  }
});

test('Bash uses Vercel grants, bounds and cleanup without host fallback; lost results hold and never replay', async () => {
  const h = await fixture();
  try {
    h.store.setMeta('sandbox:vercel', 'configured');
    h.store.setMeta('sandbox:vercel:revision', 'one');
    h.store.receipt({
      id: randomUUID(),
      kind: 'vercel-sandbox-proof',
      connectionRevision: 'one',
      status: 'passed',
      cleanup: 'deleted',
    });
    await h.vault.set('sandbox:vercel', {
      token: 'SECRET-FIXTURE-TOKEN',
      teamId: 'team_fixture',
      projectId: 'prj_fixture',
    });
    h.adapters.vercel.authorize(h.projectId);
    h.store.saveChat({ ...h.store.chat(h.chatId), execution: 'vercel', executionRevision: 'one' });
    const r = await h.bash.run({ command: "printf '%s' $((6*7))" }, h.context());
    assert.equal(r.stdout, '42');
    assert.equal(r.status, 'passed');
    assert.equal(r.cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 1);
    await assert.rejects(h.bash.run({ command: 'true', timeout_ms: 30001 }, h.context()), /30000/);
    const ctx = h.context();
    h.f.loseCommand = true;
    const failed = await h.bash.run({ command: 'printf unknown' }, ctx);
    assert.equal(failed.status, 'unknown');
    assert.equal(failed.cleanup, 'deleted');
    assert.equal(
      (await h.bash.run({ command: 'printf unknown' }, { ...ctx, callId: randomUUID() })).id,
      failed.id,
    );
    assert.equal(h.f.commands, 2);
    await assert.rejects(h.bash.run({ command: 'true', target: 'host' }, h.context()), /unknown/);
  } finally {
    await h.close();
  }
});

test(
  'hard service interruption stops the supervised host group and preserves an unknown recovery hold',
  { timeout: 10000 },
  async () => {
    const h = await fixture();
    const { spawn } = await import('node:child_process');
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/helpers/bash-crash-worker.ts', h.store.dir],
      { stdio: 'ignore' },
    );
    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', () => resolve());
      child.once('error', reject);
    });
    try {
      let receipt: Record<string, unknown> | undefined;
      for (let i = 0; i < 100; i++) {
        receipt = h.store.receipts().find((r) => r.callId === 'crash-call' && r.pid);
        if (receipt) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(receipt, 'The test must interrupt a confirmed shell, not an unstarted process.');
      child.kill('SIGKILL');
      await exited;
      await new Promise((r) => setTimeout(r, 2300));
      await assert.rejects(readFile(join(h.work, 'escaped.txt')));
      const restarted = new Bash(h.store, h.adapters);
      assert.equal(restarted.receipts().find((r) => r.callId === 'crash-call')?.status, 'unknown');
      await assert.rejects(
        restarted.run({ target: 'host', command: 'true' }, h.context()),
        /unknown/,
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      await h.close();
    }
  },
);
