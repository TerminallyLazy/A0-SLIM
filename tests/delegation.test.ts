import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FxToolContext } from 'libfx';
import { createApp } from '../src/server/app.js';
import { delegationModel } from './helpers/delegation-model.js';
import { Delegations } from '../src/runtime/delegation.js';
import { AppError } from '../src/domain.js';

async function setup(mode: Parameters<typeof delegationModel>[0] = 'normal') {
  const dir = await mkdtemp(join(tmpdir(), 'slim-delegation-')),
    root = join(dir, 'project');
  await mkdir(root);
  await writeFile(join(root, 'note.txt'), 'Paper Garden\n');
  const model = await delegationModel(mode),
    options = {
      dataDir: join(dir, 'data'),
      origin: 'http://127.0.0.1:4317',
      pairingCode: 'test',
      keySource: async () => Buffer.alloc(32, 4),
    };
  const app = await createApp(options),
    projectId = randomUUID(),
    connectionId = randomUUID(),
    chatId = randomUUID();
  app.store.saveProject({ id: projectId, name: 'Fixture', root });
  app.store.saveConnection({
    id: connectionId,
    name: 'Fixture',
    kind: 'compatible',
    baseUrl: model.url,
    model: 'fixture',
    contextWindow: 8192,
    hasCredential: false,
    verifiedAt: null,
  });
  app.store.saveChat({
    id: chatId,
    projectId,
    connectionId,
    title: 'Parent',
    model: 'fixture',
    sessionId: null,
    capabilitiesVersion: 2,
    delegationVersion: 1,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  return {
    dir,
    model,
    options,
    app,
    projectId,
    connectionId,
    chatId,
    async close() {
      await this.app.app.close();
      await model.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function until(check: () => boolean, phase = 'condition', timeoutMs = 6000) {
  const deadline = performance.now() + timeoutMs;
  while (!check() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), `${phase} completed within ${timeoutMs} ms`);
}
test(
  'native parent delegates to isolated read-only children, receives Markdown, reuses a child and reopens without duplicate work',
  { timeout: 20000 },
  async () => {
    const f = await setup('nested');
    try {
      const messageId = randomUUID();
      await f.app.runtime.prompt(f.chatId, 'Review the project.', messageId);
      await until(() => f.app.store.chat(f.chatId).status !== 'running');
      const records = f.app.runtime.delegations.list();
      assert.equal(records.length, 2);
      assert.ok(records.every((r) => r.status === 'completed'));
      const direct = records.find((r) => r.depth === 1)!;
      assert.match(direct.text!, /Paper Garden/);
      const children = f.app.store.chats().filter((c) => c.parentChatId);
      assert.equal(children.length, 2);
      assert.ok(children.every((c) => c.execution === 'none' && c.connectionId === f.connectionId));
      for (const request of f.model.requests.filter(
        (r) => !r.tools.some((t: any) => t.function.name === 'write_file'),
      )) {
        const names = request.tools.map((t: any) => t.function.name);
        assert.ok(
          !names.includes('memory_save') &&
            !names.includes('mcp_call') &&
            !names.includes('run_javascript'),
        );
      }
      const count = f.model.requests.length;
      await f.app.runtime.prompt(f.chatId, 'Review the project.', messageId);
      await until(() => f.app.store.chat(f.chatId).status !== 'running');
      assert.equal(f.model.requests.length, count);
      await assert.rejects(
        f.app.runtime.prompt(direct.childChatId, 'bypass', randomUUID()),
        /parent chat/,
      );
      await f.app.app.close();
      f.app = await createApp(f.options);
      assert.equal(f.app.runtime.delegations.list().length, 2);
      assert.equal(f.model.requests.length, count);
      await f.app.runtime.prompt(f.chatId, `continue:${direct.childChatId}`, randomUUID());
      await until(() => f.app.store.chat(f.chatId).status !== 'running');
      assert.equal(f.app.store.chats().filter((c) => c.parentChatId === f.chatId).length, 1);
      assert.equal(
        f.app.runtime.delegations.list().filter((r) => r.childChatId === direct.childChatId).length,
        2,
      );
    } finally {
      await f.app.app.close();
      await f.model.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
test(
  'stopping a parent cancels its running child; a later parent turn can run',
  { timeout: 20000 },
  async () => {
    const f = await setup('slow');
    try {
      await f.app.runtime.prompt(f.chatId, 'Review the project.', randomUUID());
      await until(() => f.model.requests.length >= 2);
      await f.app.runtime.cancel(f.chatId);
      assert.ok(
        f.app.runtime.delegations.list().every((r) => !['running', 'reserved'].includes(r.status)),
      );
      assert.equal(f.app.runtime.delegations.list()[0]!.status, 'cancelled');
      assert.ok(f.app.store.chats().every((c) => c.status !== 'running'));
      f.model.setMode('normal');
      await f.app.runtime.prompt(f.chatId, 'Review again.', randomUUID());
      await until(() => f.app.store.chat(f.chatId).status !== 'running');
      assert.equal(f.app.runtime.delegations.list()[0]!.status, 'completed');
    } finally {
      await f.close();
    }
  },
);

test(
  'Stop waits for a child awaiting session creation and prevents its first model request',
  { timeout: 15000 },
  async () => {
    const f = await setup();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = f.app.runtime.session.bind(f.app.runtime);
    f.app.runtime.session = async (id: string) => {
      if (f.app.store.chat(id).parentChatId) {
        entered();
        await gate;
      }
      return session(id);
    };
    try {
      await f.app.runtime.prompt(f.chatId, 'Review the project.', randomUUID());
      await waiting;
      let stopped = false;
      const stop = f.app.runtime.cancel(f.chatId).then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(stopped, false, 'Stop remains pending while child submission is unresolved');
      release();
      await stop;
      assert.equal(
        f.model.requests.filter((r) => !r.tools.some((t: any) => t.function.name === 'write_file'))
          .length,
        0,
        'no child model request was sent',
      );
      assert.ok(f.app.store.chats().every((c) => c.status !== 'running'));
      assert.equal(f.app.runtime.delegations.list()[0]!.status, 'cancelled');
    } finally {
      release();
      await f.close();
    }
  },
);

test(
  'SIGKILL preserves the child mapping; restart does not run it and continuation uses the same child',
  { timeout: 90000 },
  async (t) => {
    const f = await setup('slow'),
      messageId = randomUUID();
    await f.app.app.close();
    const worker = fork(
      fileURLToPath(new URL('./helpers/delegation-worker.ts', import.meta.url)),
      [f.options.dataDir, f.chatId, messageId],
      { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    try {
      await until(() => f.model.requests.length >= 2, 'child provider request');
      t.diagnostic('Child provider request observed; killing its service process.');
      const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
      worker.kill('SIGKILL');
      await exited;
      const count = f.model.requests.length;
      f.app = await createApp(f.options);
      const record = f.app.runtime.delegations.list()[0]!;
      assert.equal(record.status, 'interrupted');
      assert.equal(f.app.store.chat(record.childChatId).status, 'interrupted');
      assert.equal(f.model.requests.length, count, 'reopening makes no model request');
      t.diagnostic('Service reopened without inference; replaying original parent message.');
      f.model.setMode('normal');
      await f.app.runtime.prompt(f.chatId, 'Review the project.', messageId);
      // libfx 0.0.14 deliberately waits up to 30 seconds when a crash lands
      // between its durable end record and the viewer's terminal event.
      // Keep the no-duplicate-work assertions for both completed and unknown ends.
      await until(
        () => f.app.store.chat(f.chatId).status !== 'running',
        'replayed parent outcome',
        35000,
      );
      t.diagnostic(
        `Parent replay settled as ${f.app.store.chat(f.chatId).status}; continuing saved child.`,
      );
      assert.equal(f.app.store.chats().filter((c) => c.parentChatId).length, 1);
      assert.equal(
        f.model.requests.filter((r) => !r.tools.some((t: any) => t.function.name === 'write_file'))
          .length,
        1,
        'same parent turn cannot rerun the interrupted child',
      );
      await f.app.runtime.prompt(f.chatId, `continue:${record.childChatId}`, randomUUID());
      await until(
        () => f.app.store.chat(f.chatId).status !== 'running',
        'explicit child continuation',
        45000,
      );
      const records = f.app.runtime.delegations.list();
      assert.equal(records[0]!.childChatId, record.childChatId);
      assert.equal(records[0]!.status, 'completed');
      assert.equal(records.length, 2);
      const childRequests = f.model.requests.filter(
        (r) => !r.tools.some((t: any) => t.function.name === 'write_file'),
      );
      assert.equal(
        childRequests.length,
        3,
        'only the original request and the explicit continuation round trip reach the provider',
      );
      assert.equal(
        childRequests[1]!.messages.findLast((m: any) => m.role === 'user')?.content,
        records[0]!.assignment,
        'the next provider request belongs to the continuation, not the abandoned turn',
      );
    } finally {
      worker.kill('SIGKILL');
      await f.close();
    }
  },
);

test('delegation enforces capability inheritance, direct-child ownership, depth, concurrency and per-turn limits', async () => {
  const f = await setup();
  const { store, runtime } = f.app,
    ext = runtime.extensions;
  const ctx = (messageId: string, executionId = randomUUID(), sessionId = 'parent-session') =>
    ({
      sessionId,
      executionId,
      context: { messageId },
      signal: new AbortController().signal,
    }) as FxToolContext;
  try {
    store.saveChat({ ...store.chat(f.chatId), sessionId: 'parent-session' });
    const skill = ext.skills.import(f.projectId, {
      markdown: '---\nname: Review\ndescription: Read the note\n---\nRead note.txt.',
    });
    const first = randomUUID();
    ext.snapshot(f.projectId, f.chatId, first, 'assignment');
    ext.skills.change(f.projectId, skill.id, 'enable');
    ext.memory.setPolicy(f.projectId, { read: true, write: true });
    store.setMeta(`turn-deadline:${f.chatId}:${first}`, String(Date.now() + 60000));
    const releases: Array<() => void> = [];
    const delegates = new Delegations(store, ext, async () => {
      await new Promise<void>((r) => releases.push(r));
      return { stopReason: 'end_turn', text: 'Reviewed' };
    });
    const firstContext = ctx(first),
      job = delegates.call(f.projectId, { message: 'Review' }, firstContext);
    const other = delegates.call(f.projectId, { message: 'Second review' }, ctx(first));
    await assert.rejects(
      delegates.call(f.projectId, { message: 'Third review' }, ctx(first)),
      /already active/,
    );
    const child = delegates.list().find((r) => r.assignment === 'Review')!;
    const snapshot = JSON.parse(
      store.meta(`turn-context:${child.childChatId}:${child.messageId}`)!,
    );
    assert.deepEqual(snapshot.skills, []);
    assert.deepEqual(snapshot.memory, { read: false, write: false });
    assert.deepEqual(snapshot.mcp, []);
    const duplicate = delegates.call(f.projectId, { message: 'Review' }, firstContext);
    assert.equal(delegates.list().length, 2);
    releases.splice(0).forEach((r) => r());
    await Promise.all([job, other, duplicate]);
    await assert.rejects(
      delegates.call(f.projectId, { message: 'Different assignment' }, firstContext),
      /different assignment/,
    );
    await assert.rejects(
      delegates.call(f.projectId, { message: 'Review', context_id: f.chatId }, ctx(first)),
      /direct child/,
    );
    const immediate = new Delegations(store, ext, async () => ({
      stopReason: 'end_turn',
      text: 'Reviewed',
    }));
    store.saveChat({ ...store.chat(child.childChatId), sessionId: 'finished-child' });
    await assert.rejects(
      immediate.call(
        f.projectId,
        { message: 'Start a grandchild' },
        ctx(child.messageId, randomUUID(), 'finished-child'),
      ),
      /No active parent assignment/,
    );
    for (let i = 0; i < 4; i++)
      await immediate.call(f.projectId, { message: 'Review' }, ctx(first));
    await assert.rejects(
      immediate.call(f.projectId, { message: 'Review' }, ctx(first)),
      /six-assignment/,
    );
    store.saveChat({ ...store.chat(child.childChatId), depth: 2, sessionId: 'leaf' });
    await assert.rejects(
      immediate.call(
        f.projectId,
        { message: 'Review' },
        ctx(child.messageId, randomUUID(), 'leaf'),
      ),
      /not available/,
    );
    const next = randomUUID();
    ext.snapshot(f.projectId, f.chatId, next, 'next');
    store.setMeta(`turn-deadline:${f.chatId}:${next}`, String(Date.now() + 60000));
    await immediate.call(f.projectId, { message: 'Review' }, ctx(next));
    const permitted = immediate.list()[0]!;
    const allowed = JSON.parse(
      store.meta(`turn-context:${permitted.childChatId}:${permitted.messageId}`)!,
    );
    assert.equal(allowed.skills[0].id, skill.id);
    assert.deepEqual(allowed.memory, { read: true, write: false });
    store.saveChat({ ...store.chat(permitted.childChatId), sessionId: 'child' });
    ext.skills.change(f.projectId, skill.id, 'disable');
    ext.memory.setPolicy(f.projectId, { read: false, write: false });
    await assert.rejects(
      async () =>
        ext
          .tools(f.projectId)
          .find((t) => t.name === 'skills_tool')!
          .execute({ id: skill.id }, ctx(permitted.messageId, randomUUID(), 'child')),
      /permission or revision changed/,
    );
    await assert.rejects(
      async () =>
        ext
          .tools(f.projectId)
          .find((t) => t.name === 'memory_load')!
          .execute({ query: 'note' }, ctx(permitted.messageId, randomUUID(), 'child')),
      /permission is off/,
    );
    store.setMeta(`turn-deadline:${f.chatId}:${next}`, String(Date.now() - 1));
    await assert.rejects(
      immediate.call(f.projectId, { message: 'Review' }, ctx(next)),
      /remaining time/,
    );
  } finally {
    await f.close();
  }
});
test('unconfirmed child cleanup preserves the recovery hold even when Stop was requested', async () => {
  const f = await setup();
  try {
    const { store } = f.app,
      ext = f.app.runtime.extensions;
    store.saveChat({ ...store.chat(f.chatId), sessionId: 'parent-session' });
    const abort = new AbortController();
    const delegates = new Delegations(store, ext, async () => {
      abort.abort();
      throw new AppError(409, 'delegation_recovery_unknown', 'No terminal evidence.');
    });
    const context = (messageId: string, signal: AbortSignal) => {
      ext.snapshot(f.projectId, f.chatId, messageId, 'Review');
      store.setMeta(`turn-deadline:${f.chatId}:${messageId}`, String(Date.now() + 60_000));
      return {
        sessionId: 'parent-session',
        context: { messageId },
        executionId: randomUUID(),
        signal,
      } as FxToolContext;
    };
    const result = await delegates.call(
      f.projectId,
      { message: 'Review' },
      context(randomUUID(), abort.signal),
    );
    assert.equal(result.status, 'interrupted');
    assert.deepEqual(
      await delegates.call(
        f.projectId,
        { message: 'Replacement review' },
        context(randomUUID(), new AbortController().signal),
      ),
      result,
    );
    assert.equal(delegates.list().length, 1, 'a new call cannot replace the unresolved child');
  } finally {
    await f.close();
  }
});

test(
  'subordinate model loops stop at eight requests and consume the shared connection budget',
  { timeout: 15000 },
  async () => {
    const f = await setup('loop');
    try {
      await f.app.runtime.prompt(f.chatId, 'Review the project.', randomUUID());
      await until(() => f.app.store.chat(f.chatId).status !== 'running');
      const record = f.app.runtime.delegations.list()[0]!;
      assert.equal(record.status, 'failed');
      const children = f.model.requests.filter(
        (r) => !r.tools.some((t: any) => t.function.name === 'write_file'),
      );
      assert.equal(children.length, 8);
      const budgets = f.app.store.db
        .prepare("SELECT value FROM meta WHERE key LIKE 'budget:%'")
        .all() as { value: string }[];
      assert.equal(budgets.length, 1);
      assert.ok(JSON.parse(budgets[0]!.value).count >= 10);
    } finally {
      await f.close();
    }
  },
);
