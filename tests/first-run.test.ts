import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { FirstRun } from '../src/server/first-run.js';
import { Store } from '../src/storage/store.js';
import { ChatGPTAccounts } from '../src/providers/chatgpt.js';
import { appVersion } from '../src/version.js';
import { startModelFixture } from './helpers/model-server.js';

const origin = 'http://127.0.0.1:4310';
async function harness(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'slim-first-run-'));
  const service = await createApp({
    dataDir: join(dir, 'data'),
    workspaceRoot: join(dir, 'workspace'),
    origin,
    pairingCode: 'fixture',
    keySource: async () => Buffer.alloc(32, 7),
    ...options,
  });
  let cookie = '';
  const call = (method: 'GET' | 'POST', path: string, payload?: unknown, extra = {}) =>
    service.app.inject({
      method,
      url: `/api/v1${path}`,
      headers: {
        host: '127.0.0.1:4310',
        origin,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  const pair = async () => {
    const r = await call('POST', '/pair', { code: 'fixture' });
    cookie = String(r.headers['set-cookie']).split(';')[0]!;
  };
  return {
    ...service,
    dir,
    call,
    pair,
    close: async () => {
      await service.app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test(
  'first run pairs, resumes, and starts the native agent without an external agent or sandbox',
  { timeout: 30000 },
  async () => {
    const model = await startModelFixture({ tool: 'list_dir' });
    const h = await harness();
    try {
      assert.equal((await h.call('POST', '/setup/workspace', {})).statusCode, 401);
      await h.pair();
      assert.equal(
        (await h.call('POST', '/setup/workspace', {}, { origin: 'https://evil.test' })).statusCode,
        403,
      );
      assert.equal((await h.call('GET', '/state')).json().firstRun.required, true);
      assert.equal((await h.call('POST', '/setup/complete', {})).statusCode, 409);
      await h.call('POST', '/setup/preferences', {});
      const [a, b] = await Promise.all([
        h.call('POST', '/setup/workspace', {}),
        h.call('POST', '/setup/workspace', {}),
      ]);
      assert.equal(a.statusCode, 200, a.body);
      const project = a.json();
      assert.equal(b.json().id, project.id);
      assert.equal(h.store.projects().length, 1);
      assert.equal(project.execution, 'none');
      assert.equal(
        (await new FirstRun(h.store, join(h.dir, 'workspace')).workspace()).id,
        project.id,
      );
      const connection = (
        await h.call('POST', '/connections', {
          name: 'Local fixture',
          kind: 'compatible',
          model: 'fixture',
          baseUrl: model.url,
        })
      ).json();
      await h.call('POST', '/setup/preferences', { connectionId: connection.id });
      const resumed = new FirstRun(h.store, join(h.dir, 'workspace')).state();
      assert.equal(resumed.required, true);
      assert.equal(resumed.connectionId, connection.id);
      assert.equal((await h.call('POST', '/setup/complete', {})).json().required, false);
      assert.equal(h.store.chats().length, 0);
      assert.equal(model.requests.length, 0);
      const chat = (
        await h.call('POST', '/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'First chat',
        })
      ).json();
      assert.notEqual(chat.backend, 'acp');
      assert.equal(chat.bashVersion, 1);
      const sent = await h.call('POST', `/chats/${chat.id}/messages`, {
        text: 'List my workspace.',
        messageId: randomUUID(),
      });
      assert.equal(sent.statusCode, 200, sent.body);
      const reader = (await h.runtime.stream(chat.id, 0)).getReader();
      let events = '';
      while (!events.includes('turn_end')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        events += new TextDecoder().decode(chunk.value);
      }
      await reader.cancel();
      assert.match(events, /Fixture completed/);
      assert.ok(model.requests.length >= 2);
      assert.equal(h.store.project(project.id).execution, 'none');
      assert.equal((await h.call('GET', '/status')).json().version, appVersion);
      assert.equal(JSON.parse(await readFile('package.json', 'utf8')).version, appVersion);
    } finally {
      await h.close();
      await model.close();
    }
  },
);

test('starter workspace never claims unrelated directories, symlinks, private storage or changed ownership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-workspace-'));
  const store = new Store(join(dir, 'data'));
  try {
    const existing = join(dir, 'existing');
    await mkdir(existing);
    await assert.rejects(new FirstRun(store, existing).workspace(), /already exists/);
    const link = join(dir, 'link');
    await symlink(existing, link);
    await assert.rejects(new FirstRun(store, link).workspace(), /already exists/);
    await assert.rejects(
      new FirstRun(store, join(store.dir, 'workspace')).workspace(),
      /private application data/,
    );
    const setup = new FirstRun(store, join(dir, 'new'));
    await setup.workspace();
    await writeFile(join(dir, 'new', '.slim-workspace.json'), '{}');
    await assert.rejects(setup.workspace(), /ownership/);
    assert.equal(store.projects().length, 1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('interrupted starter directory without its marker requires explicit selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-interrupted-'));
  const store = new Store(join(dir, 'data'));
  try {
    const root = join(dir, 'workspace');
    await mkdir(root);
    store.setMeta(
      'first-run-workspace',
      JSON.stringify({ id: randomUUID(), root, nonce: randomUUID() }),
    );
    await assert.rejects(new FirstRun(store, root).workspace(), /interrupted/);
    assert.equal(store.projects().length, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ChatGPT first run discovers and selects an account model without spending inference allowance', async () => {
  let nonce = '';
  const requests: string[] = [];
  const h = await harness({
    accountsFactory: (store, vault) =>
      new ChatGPTAccounts(
        store,
        vault,
        async (url) => {
          requests.push(String(url));
          if (String(url).endsWith('/models'))
            return Response.json({
              models: [
                { slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' },
              ],
            });
          return Response.json({
            access_token: 'synthetic',
            refresh_token: 'synthetic-refresh',
            id_token: 'fixture',
            expires_in: 3600,
            scope: 'openid chatgpt.tokens.use.direct',
          });
        },
        async () => ({ sub: 'fixture-user', exp: Math.floor(Date.now() / 1000) + 3600, nonce }),
      ),
  });
  try {
    await h.pair();
    await h.call('POST', '/setup/preferences', {});
    const start = new URL((await h.call('POST', '/chatgpt/start', {})).json().url);
    nonce = start.searchParams.get('nonce')!;
    const callback = await h.app.inject({
      method: 'GET',
      url: `/auth/callback?${new URLSearchParams({ state: start.searchParams.get('state')!, code: 'fixture', client_id: 'fixture-client' })}`,
      headers: { host: '127.0.0.1:4310' },
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, '/?connection=added');
    const c = h.store.connections()[0]!;
    assert.equal(
      (await h.call('POST', '/setup/preferences', { connectionId: c.id })).statusCode,
      409,
    );
    const models = (await h.call('GET', `/connections/${c.id}/models`)).json();
    assert.equal(models[0].id, 'fixture-model');
    assert.equal(
      (await h.call('POST', `/connections/${c.id}/model`, { model: 'invented' })).statusCode,
      400,
    );
    assert.equal(
      (await h.call('POST', `/connections/${c.id}/model`, { model: 'fixture-model' })).statusCode,
      200,
    );
    await h.call('POST', '/setup/preferences', { connectionId: c.id });
    await h.call('POST', '/setup/workspace', {});
    assert.equal((await h.call('POST', '/setup/complete', {})).json().required, false);
    assert.ok(requests.every((url) => url.endsWith('/token') || url.endsWith('/models')));
    assert.equal(h.store.chats().length, 0);
  } finally {
    await h.close();
  }
});

test('ready existing installations keep their workspace and execution preferences', async () => {
  const h = await harness();
  try {
    const root = join(h.dir, 'existing');
    await mkdir(root);
    h.store.saveProject({ id: randomUUID(), name: 'Existing', root, execution: 'none' });
    h.store.saveConnection({
      id: randomUUID(),
      name: 'Existing model',
      kind: 'compatible',
      model: 'fixture',
      baseUrl: 'http://127.0.0.1:1234/v1',
      hasCredential: false,
      contextWindow: 8192,
      verifiedAt: null,
    });
    await h.pair();
    assert.equal((await h.call('GET', '/state')).json().firstRun.required, false);
    assert.equal(h.store.projects().length, 1);
  } finally {
    await h.close();
  }
});
