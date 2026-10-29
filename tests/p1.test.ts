import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { startModelFixture } from './helpers/model-server.js';
import { Store } from '../src/storage/store.js';
import { RequestBudget } from '../src/policy/budget.js';

test(
  'native model → proposed artifact → authenticated exact approval → project bytes; redirect stays tracked',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-p1-')),
      root = join(dir, 'project');
    await mkdir(root);
    const fixture = await startModelFixture({
      tool: 'write_file',
      toolInput: { path: 'result.md', content: '# Synthetic artifact\n' },
      delayMs: 200,
    });
    const { app, store, runtime } = await createApp({
      dataDir: join(dir, 'data'),
      origin: 'http://127.0.0.1:4310',
      pairingCode: 'fixture',
      keySource: async () => Buffer.alloc(32, 7),
    });
    let cookie = '';
    const call = (url: string, payload?: unknown, origin = 'http://127.0.0.1:4310') =>
      app.inject({
        method: payload === undefined ? 'GET' : 'POST',
        url: `/api/v1${url}`,
        headers: {
          host: '127.0.0.1:4310',
          origin,
          cookie,
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        payload: payload === undefined ? undefined : JSON.stringify(payload),
      });
    const idle = async (id: string) => {
      const deadline = Date.now() + 5000;
      while (store.chat(id).status === 'running' && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 5));
      assert.equal(store.chat(id).status, 'idle');
    };
    try {
      const paired = await call('/pair', { code: 'fixture' });
      cookie = String(paired.headers['set-cookie']).split(';')[0]!;
      const project = (await call('/projects', { name: 'Fixture', root })).json();
      // Preserve coverage of existing projects and their original runtime contract.
      store.saveProject({ ...store.project(project.id), access: undefined });
      const connection = (
        await call('/connections', {
          name: 'Fixture',
          kind: 'compatible',
          model: 'fixture',
          baseUrl: fixture.url,
        })
      ).json();
      const chat = (
        await call('/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'Artifact',
        })
      ).json();
      assert.equal(
        (
          await call(`/chats/${chat.id}/messages`, {
            text: 'Draft result.md',
            messageId: randomUUID(),
          })
        ).statusCode,
        200,
      );
      await idle(chat.id);
      const operation = store.operations()[0]!;
      assert.ok(operation);
      assert.equal(operation.status, 'pending');
      await assert.rejects(readFile(join(root, 'result.md')), { code: 'ENOENT' });
      assert.equal(
        (
          await call(
            `/artifacts/${operation.id}/apply`,
            { digest: operation.digest },
            'https://evil.test',
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (await call(`/artifacts/${operation.id}/apply`, { digest: '0'.repeat(64) })).statusCode,
        409,
      );
      assert.equal(
        (await call(`/artifacts/${operation.id}/apply`, { digest: operation.digest })).json()
          .status,
        'applied',
      );
      assert.equal(await readFile(join(root, 'result.md'), 'utf8'), '# Synthetic artifact\n');
      const download = await call(`/artifacts/${operation.id}/download`);
      assert.match(String(download.headers['content-disposition']), /attachment/);
      assert.equal(download.body, '# Synthetic artifact\n');
      assert.equal(
        (
          await call(`/chats/${chat.id}/messages`, {
            text: 'Start another task',
            messageId: randomUUID(),
          })
        ).statusCode,
        200,
      );
      const redirected = await call(`/chats/${chat.id}/steer`, {
        text: 'Use this revised direction.',
        messageId: randomUUID(),
      });
      assert.equal(redirected.statusCode, 200, redirected.body);
      await idle(chat.id);
      assert.ok(
        fixture.requests.at(-1)!.messages.some((m) => m.content === 'Use this revised direction.'),
      );
      assert.ok(store.connection(connection.id).verifiedAt);
      await runtime.cancel(chat.id);
    } finally {
      await app.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('schema upgrades keep a private pre-migration backup and budgets survive process reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-migration-'));
  let store = new Store(dir);
  try {
    store.setMeta('schema_version', '1');
    store.setMeta('preserved', 'yes');
    new RequestBudget(store, 'fixture', 2, 600000, () => 100).consume();
    store.close();
    store = new Store(dir);
    assert.equal(store.meta('schema_version'), '3');
    assert.equal(store.meta('preserved'), 'yes');
    assert.equal((await readdir(join(dir, 'backups'))).length, 1);
    const budget = new RequestBudget(store, 'fixture', 2, 600000, () => 100);
    budget.consume();
    assert.throws(() => budget.consume(), /request limit/);
    new RequestBudget(store, 'fixture', 2, 600000, () => 600100).consume();
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'a looping native model is stopped by the persistent request budget before request 41',
  { timeout: 15000 },
  async () => {
    const { realpath } = await import('node:fs/promises');
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-budget-loop-'))),
      root = join(dir, 'project');
    await mkdir(root);
    const fixture = await startModelFixture({ tool: 'list_dir', alwaysTool: true });
    const { app, store, runtime } = await createApp({
      dataDir: join(dir, 'data'),
      origin: 'http://127.0.0.1:4310',
      pairingCode: 'fixture',
      keySource: async () => Buffer.alloc(32, 1),
    });
    const projectId = randomUUID(),
      connectionId = randomUUID(),
      chatId = randomUUID();
    store.saveProject({ id: projectId, name: 'Budget fixture', root });
    store.saveConnection({
      id: connectionId,
      name: 'Fixture',
      kind: 'compatible',
      model: 'fixture',
      baseUrl: fixture.url,
      contextWindow: 32768,
      hasCredential: false,
      verifiedAt: null,
    });
    store.saveChat({
      id: chatId,
      title: 'Bounded loop',
      projectId,
      connectionId,
      model: 'fixture',
      sessionId: null,
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    try {
      await runtime.prompt(chatId, 'List the directory.', randomUUID());
      const deadline = Date.now() + 10000;
      while (store.chat(chatId).status === 'running' && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 5));
      assert.notEqual(store.chat(chatId).status, 'running');
      assert.equal(fixture.requests.length, 40);
      assert.match(store.chat(chatId).lastStop ?? '', /40-request limit/);
    } finally {
      await app.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
