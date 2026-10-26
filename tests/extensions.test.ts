import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { Extensions } from '../src/extensions/runtime.js';
import { PluginHub } from '../src/extensions/hub.js';
import { createApp } from '../src/server/app.js';
import { startModelFixture } from './helpers/model-server.js';
const md =
  '---\nname: project-research\ndescription: Ground project work in files and verified evidence.\n---\nRead the relevant project files, then check the result.';
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-ext-')),
    store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 5)),
    ext = new Extensions(store, vault),
    projectId = randomUUID();
  store.saveProject({ id: projectId, name: 'Fixture', root: dir });
  return {
    dir,
    store,
    vault,
    ext,
    projectId,
    close: async () => {
      await ext.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function mcpFixture() {
  let calls = 0,
    fail = false,
    changed = false;
  const authorization: string[] = [],
    paths: string[] = [];
  const server = createServer(async (req, res) => {
    authorization.push(req.headers.authorization ?? '');
    paths.push(req.url ?? '');
    if (req.method === 'GET') {
      res.writeHead(405).end();
      return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: unknown = {};
    if (body.method === 'initialize')
      result = {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'synthetic', version: '1.0.0' },
      };
    else if (body.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'lookup',
            description: changed ? 'Changed tool' : 'Synthetic lookup',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      };
    else if (body.method === 'tools/call') {
      calls++;
      if (fail) {
        res.destroy();
        return;
      }
      result = { content: [{ type: 'text', text: `Result: ${body.params.arguments.text}` }] };
    }
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    calls: () => calls,
    authorization,
    paths,
    fail: () => {
      fail = true;
    },
    change: () => {
      changed = true;
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

test('portable skills are disabled on import/update/rollback; immutable turn catalog respects revocation and project scope', async () => {
  const f = await setup();
  try {
    const s = f.ext.skills.import(f.projectId, { markdown: md });
    assert.equal(s.enabled, false);
    assert.throws(() =>
      f.ext.skills.import(f.projectId, { markdown: '---\nname: broken\n---\nbody' }),
    );
    f.ext.skills.change(f.projectId, s.id, 'enable');
    const snap = f.ext.snapshot(f.projectId, 'chat', 'turn', 'Research');
    assert.equal(snap.skills[0]?.id, s.id);
    assert.throws(() => f.ext.snapshot(f.projectId, 'chat', 'turn', 'Different'), /different text/);
    assert.match(
      f.ext.skills.load(f.projectId, s.id, s.current.digest).instructions,
      /Read the relevant/,
    );
    const next = f.ext.skills.import(f.projectId, { id: s.id, markdown: md + '\nNew instruction' });
    assert.equal(next.enabled, false);
    assert.throws(() => f.ext.skills.load(f.projectId, s.id, s.current.digest), /changed/);
    const rolled = f.ext.skills.change(f.projectId, s.id, 'rollback')!;
    assert.equal(rolled.current.digest, s.current.digest);
    assert.equal(rolled.enabled, false);
    const other = randomUUID();
    f.store.saveProject({ id: other, name: 'Other', root: f.dir });
    assert.throws(() => f.ext.skills.get(other, s.id), /not found/);
    f.ext.skills.change(f.projectId, s.id, 'delete');
    assert.equal(f.ext.skills.list(f.projectId).length, 0);
  } finally {
    await f.close();
  }
});
test('official MCP client discovers, exact approval executes once, changed schema and unknown effects fail closed', async () => {
  const f = await setup(),
    remote = await mcpFixture();
  try {
    const server = await f.ext.mcp.add(f.projectId, {
      name: 'Synthetic',
      transport: 'http',
      url: remote.url,
      token: 'synthetic-key',
    });
    assert.equal(remote.calls(), 0);
    assert.equal(server.enabled, false);
    assert.throws(
      () => f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'test' }, 'x'),
      /not enabled/,
    );
    const found = await f.ext.mcp.discover(f.projectId, server.id);
    assert.equal(found.tools[0]?.name, 'lookup');
    f.ext.mcp.configure(f.projectId, server.id, true, ['lookup']);
    const call = f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'test' }, 'x');
    assert.equal(remote.calls(), 0);
    await assert.rejects(f.ext.mcp.approve(f.projectId, call.id, '0'.repeat(64)), /does not match/);
    const done = await f.ext.mcp.approve(f.projectId, call.id, call.digest);
    assert.equal(done.status, 'completed');
    assert.match(done.result!, /Result: test/);
    await f.ext.mcp.approve(f.projectId, call.id, call.digest);
    assert.equal(remote.calls(), 1);
    assert.equal(
      f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'test' }, 'x').status,
      'completed',
    );
    assert.ok(remote.authorization.every((h) => h === 'Bearer synthetic-key'));
    assert.ok(!JSON.stringify(f.store.records('mcp')).includes('synthetic-key'));
    const changed = f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'new' }, 'y');
    remote.change();
    await assert.rejects(
      f.ext.mcp.approve(f.projectId, changed.id, changed.digest),
      /schema changed/,
    );
    assert.equal(remote.calls(), 1);
    f.ext.mcp.resolve(f.projectId, changed.id, 'reject', '');
    await f.ext.mcp.discover(f.projectId, server.id);
    assert.deepEqual(f.ext.mcp.get(f.projectId, server.id).allowed, []);
    f.ext.mcp.configure(f.projectId, server.id, true, ['lookup']);
    const unknown = f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'lost' }, 'z');
    remote.fail();
    assert.equal(
      (await f.ext.mcp.approve(f.projectId, unknown.id, unknown.digest)).status,
      'unknown',
    );
    assert.throws(
      () => f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'retry' }, 'new-key'),
      /unknown/,
    );
    await assert.rejects(f.ext.mcp.remove(f.projectId, server.id), /unknown/);
    assert.equal(remote.calls(), 2);
    const duplicate = await f.ext.mcp.add(f.projectId, {
      name: 'Duplicate endpoint',
      transport: 'http',
      url: remote.url,
    });
    await f.ext.mcp.discover(f.projectId, duplicate.id);
    f.ext.mcp.configure(f.projectId, duplicate.id, true, ['lookup']);
    assert.throws(
      () =>
        f.ext.mcp.stage(
          f.projectId,
          duplicate.id,
          'lookup',
          { text: 'Retry through another connection' },
          'bypass',
        ),
      /unknown/,
    );
    f.ext.mcp.resolve(
      f.projectId,
      unknown.id,
      'resolve',
      'Checked synthetic server: the request executed once.',
    );
    await f.ext.mcp.remove(f.projectId, server.id);
    assert.equal(await f.vault.get(`mcp:${server.id}`), null);
  } finally {
    await remote.close();
    await f.close();
  }
});
test('MCP rejects implicit host execution and turns persisted running calls into unknown after restart', async () => {
  const f = await setup();
  try {
    await assert.rejects(
      f.ext.mcp.add(f.projectId, { name: 'No', transport: 'stdio', command: '/bin/sh' }),
      /explicitly allow/,
    );
    f.store.record('mcp-call', { id: randomUUID(), projectId: f.projectId, status: 'running' });
    const ext = new Extensions(f.store, f.vault);
    assert.equal(ext.mcp.calls(f.projectId)[0]?.status, 'unknown');
    await ext.close();
  } finally {
    await f.close();
  }
});
test('Hub uses pinned tree evidence, ignores upstream compatibility assertions, preserves last good catalog and rejects stale overwrite', async () => {
  const f = await setup();
  try {
    const commit = 'a'.repeat(40);
    let failure = false;
    const read = async (url: string) => {
      if (failure) throw new Error('Offline');
      if (url.includes('/git/trees/'))
        return JSON.stringify({
          tree: [
            { path: 'main.py', type: 'blob' },
            { path: 'skills/foo/SKILL.md', type: 'blob' },
          ],
        });
      if (url.includes('raw.githubusercontent')) return md;
      return JSON.stringify({
        plugins: {
          fixture: {
            title: 'Fixture',
            github: 'https://github.com/example/plugin',
            commit,
            version: '1',
            slim: true,
          },
        },
      });
    };
    const hub = new PluginHub(f.store, read);
    await hub.refresh();
    assert.equal(hub.entry('fixture').assessment, undefined);
    const assessment = await hub.assess('fixture');
    assert.equal(assessment.status, 'Requires Agent Zero');
    assert.equal(assessment.commit, commit);
    assert.equal((await hub.skill('fixture', 'skills/foo/SKILL.md')).markdown, md);
    await assert.rejects(hub.skill('fixture', '../../private'), /Assess/);
    failure = true;
    await assert.rejects(hub.refresh());
    assert.equal(hub.catalog()?.entries.length, 1);
    let resolveFirst!: (s: string) => void,
      calls = 0;
    const racing = new PluginHub(f.store, async () => {
      calls++;
      if (calls === 1)
        return new Promise<string>((r) => {
          resolveFirst = r;
        });
      return JSON.stringify({
        plugins: {
          newer: {
            title: 'Newer',
            github: 'https://github.com/example/plugin',
            commit,
            version: '2',
          },
        },
      });
    });
    const first = racing.refresh();
    await racing.refresh();
    resolveFirst(
      JSON.stringify({
        plugins: {
          older: {
            title: 'Older',
            github: 'https://github.com/example/plugin',
            commit,
            version: '1',
          },
        },
      }),
    );
    await first;
    assert.equal(racing.catalog()?.entries[0]?.id, 'newer');
  } finally {
    await f.close();
  }
});
test('native agent loads an enabled skill and receives scoped automatic recall, then respects disable on the next turn', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-native-ext-')),
    root = join(dir, 'project');
  await mkdir(root);
  const skillId = randomUUID(),
    fixture = await startModelFixture({ tool: 'skills_tool', toolInput: { id: skillId } });
  const { app, store, runtime } = await createApp({
    dataDir: join(dir, 'data'),
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'test',
    keySource: async () => Buffer.alloc(32, 4),
  });
  try {
    const projectId = randomUUID(),
      connectionId = randomUUID(),
      chatId = randomUUID();
    store.saveProject({ id: projectId, name: 'Project', root });
    store.saveConnection({
      id: connectionId,
      name: 'Fixture',
      kind: 'compatible',
      model: 'fixture',
      baseUrl: fixture.url,
      contextWindow: 8192,
      hasCredential: false,
      verifiedAt: null,
    });
    store.saveChat({
      id: chatId,
      title: 'P2 native',
      projectId,
      connectionId,
      model: 'fixture',
      sessionId: null,
      capabilitiesVersion: 2,
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    const skill = runtime.extensions.skills.import(projectId, { markdown: md });
    store.removeRecord('skill', skill.id);
    store.record('skill', { ...skill, id: skillId, enabled: true });
    runtime.extensions.memory.save(
      projectId,
      { text: 'The garden project uses sage green.', source: 'Synthetic owner note' },
      'seed',
    );
    runtime.extensions.memory.setPolicy(projectId, { read: true, write: false });
    const idle = async () => {
      const deadline = Date.now() + 5000;
      while (store.chat(chatId).status === 'running' && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(store.chat(chatId).status, 'idle');
    };
    await runtime.prompt(chatId, 'Inspect the garden project.', randomUUID());
    await idle();
    assert.ok(fixture.requests.some((r) => JSON.stringify(r.messages).includes('sage green')));
    assert.ok(
      fixture.requests.some((r) =>
        r.messages.some(
          (m) =>
            m.role === 'tool' &&
            JSON.stringify(m.content).includes('Read the relevant project files'),
        ),
      ),
    );
    runtime.extensions.skills.change(projectId, skillId, 'disable');
    await runtime.prompt(chatId, 'Inspect again.', randomUUID());
    await idle();
    assert.ok(
      fixture.requests.some((r) =>
        r.messages.some(
          (m) => m.role === 'tool' && JSON.stringify(m.content).includes('not in this turn'),
        ),
      ),
    );
  } finally {
    await app.close();
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('stdio MCP uses explicit full-trust authorization, a minimal environment and closes each owned process', async () => {
  const f = await setup(),
    prior = process.env.A0_SLIM_TEST_SECRET;
  process.env.A0_SLIM_TEST_SECRET = 'must-not-leak';
  try {
    const server = await f.ext.mcp.add(f.projectId, {
      name: 'Local fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [new URL('./helpers/mcp-stdio-fixture.mjs', import.meta.url).pathname],
      acknowledgeHostExecution: true,
    });
    await f.ext.mcp.discover(f.projectId, server.id);
    f.ext.mcp.configure(f.projectId, server.id, true, ['echo']);
    const call = f.ext.mcp.stage(f.projectId, server.id, 'echo', { text: 'synthetic' }, 'stdio');
    const result = await f.ext.mcp.approve(f.projectId, call.id, call.digest);
    assert.equal(result.status, 'completed');
    assert.match(result.result!, /"inheritedSecret":false/);
    await f.ext.mcp.remove(f.projectId, server.id);
  } finally {
    if (prior === undefined) delete process.env.A0_SLIM_TEST_SECRET;
    else process.env.A0_SLIM_TEST_SECRET = prior;
    await f.close();
  }
});
test('P2 API keeps project grants scoped, applies Origin checks and never returns embedding credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-ext-api-')),
    root = join(dir, 'project');
  await mkdir(root);
  const { app, store } = await createApp({
    dataDir: join(dir, 'data'),
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'test',
    keySource: async () => Buffer.alloc(32, 4),
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
  try {
    assert.equal((await call('/embeddings')).statusCode, 401);
    cookie = String((await call('/pair', { code: 'test' })).headers['set-cookie']).split(';')[0]!;
    const project = (await call('/projects', { name: 'Synthetic', root })).json(),
      other = (await call('/projects', { name: 'Other', root })).json();
    const base = `/projects/${project.id}`;
    const skill = (await call(`${base}/skills`, { markdown: md })).json();
    assert.equal(
      (await call(`/projects/${other.id}/skills/${skill.id}`, { action: 'enable' })).statusCode,
      404,
    );
    assert.equal(
      (await call(`${base}/memory/policy`, { read: true, write: true }, 'https://evil.test'))
        .statusCode,
      403,
    );
    assert.equal(
      (await call(`${base}/memory/policy`, { read: true, write: false, extra: true })).statusCode,
      400,
    );
    const saved = (
      await call('/embeddings', {
        name: 'Synthetic',
        baseUrl: 'https://example.com/v1',
        model: 'test',
        revision: '1',
        dimension: 3,
        apiKey: 'private-test-token',
      })
    ).json();
    assert.equal(saved.hasCredential, true);
    assert.ok(!JSON.stringify((await call('/embeddings')).json()).includes('private-test-token'));
    assert.ok(!JSON.stringify(store.records('embedding')).includes('private-test-token'));
    assert.equal(
      (await call('/memory/backups/delete', { name: '../../a0-slim.db', acknowledge: true }))
        .statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('new native chats execute memory tools and stage MCP without an external effect; both survive service reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-native-tools-')),
    root = join(dir, 'project');
  await mkdir(root);
  const remote = await mcpFixture();
  const memoryFixture = await startModelFixture({
    tool: 'memory_save',
    toolInput: {
      text: 'The synthetic project uses sage green.',
      source: 'Owner request',
      area: 'main',
    },
  });
  const options = {
    dataDir: join(dir, 'data'),
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'test',
    keySource: async () => Buffer.alloc(32, 4),
  };
  let instance = await createApp(options);
  let toolFixture: Awaited<ReturnType<typeof startModelFixture>> | undefined;
  const idle = async (id: string) => {
    for (let i = 0; i < 500 && instance.store.chat(id).status === 'running'; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(instance.store.chat(id).status, 'idle');
  };
  const projectId = randomUUID(),
    connectionId = randomUUID(),
    chatId = randomUUID();
  try {
    instance.store.saveProject({ id: projectId, name: 'Synthetic', root });
    instance.store.saveConnection({
      id: connectionId,
      name: 'Synthetic',
      kind: 'compatible',
      model: 'fixture',
      baseUrl: memoryFixture.url,
      contextWindow: 8192,
      hasCredential: false,
      verifiedAt: null,
    });
    instance.store.saveChat({
      id: chatId,
      title: 'Memory native',
      projectId,
      connectionId,
      model: 'fixture',
      sessionId: null,
      capabilitiesVersion: 2,
      status: 'idle',
      createdAt: new Date().toISOString(),
    });
    instance.runtime.extensions.memory.setPolicy(projectId, { read: true, write: true });
    await instance.runtime.prompt(
      chatId,
      'Remember that the project uses sage green.',
      randomUUID(),
    );
    await idle(chatId);
    assert.equal(instance.runtime.extensions.memory.list(projectId).length, 1);
    const server = await instance.runtime.extensions.mcp.add(projectId, {
      name: 'Synthetic tool',
      transport: 'http',
      url: remote.url,
    });
    await instance.runtime.extensions.mcp.discover(projectId, server.id);
    instance.runtime.extensions.mcp.configure(projectId, server.id, true, ['lookup']);
    toolFixture = await startModelFixture({
      tool: 'mcp_call',
      toolInput: { serverId: server.id, tool: 'lookup', arguments: { text: 'Synthetic lookup' } },
    });
    const toolConnection = randomUUID(),
      toolChat = randomUUID();
    instance.store.saveConnection({
      ...instance.store.connection(connectionId),
      id: toolConnection,
      baseUrl: toolFixture.url,
    });
    instance.store.saveChat({
      ...instance.store.chat(chatId),
      id: toolChat,
      sessionId: null,
      connectionId: toolConnection,
    });
    await instance.runtime.prompt(toolChat, 'Look up the synthetic reference.', randomUUID());
    await idle(toolChat);
    const staged = instance.runtime.extensions.mcp.calls(projectId)[0]!;
    assert.equal(staged.status, 'pending');
    assert.equal(remote.calls(), 0);
    await instance.app.close();
    instance = await createApp(options);
    assert.equal(instance.runtime.extensions.memory.list(projectId).length, 1);
    assert.equal(instance.runtime.extensions.mcp.calls(projectId)[0]?.status, 'pending');
    await instance.runtime.extensions.mcp.approve(projectId, staged.id, staged.digest);
    assert.equal(remote.calls(), 1);
    await instance.runtime.prompt(chatId, 'Keep the saved garden fact.', randomUUID());
    await idle(chatId);
    assert.equal(instance.runtime.extensions.memory.list(projectId).length, 1);
  } finally {
    await instance.app.close();
    await memoryFixture.close();
    await toolFixture?.close();
    await remote.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Agent Zero bridge builds token-bearing MCP routes only at transport and stores no token in public connection metadata', async () => {
  const f = await setup(),
    remote = await mcpFixture();
  try {
    await assert.rejects(
      f.ext.mcp.add(f.projectId, {
        name: 'Bad URL',
        transport: 'http',
        url: remote.url + '/t-secret/http',
      }),
      /protected|separate token/,
    );
    const server = await f.ext.mcp.add(f.projectId, {
      name: 'Agent Zero',
      transport: 'agent-zero',
      url: new URL(remote.url).origin,
      token: 'bridge-secret',
      remoteProject: 'synthetic',
    });
    assert.ok(!JSON.stringify(server).includes('bridge-secret'));
    assert.ok(!JSON.stringify(f.store.records('mcp')).includes('bridge-secret'));
    await f.ext.mcp.discover(f.projectId, server.id);
    assert.ok(remote.authorization.every((v) => v === ''));
    assert.ok(remote.paths.every((path) => path === '/mcp/t-bridge-secret/p-synthetic/http'));
    f.ext.mcp.configure(f.projectId, server.id, true, ['lookup']);
    const call = f.ext.mcp.stage(f.projectId, server.id, 'lookup', { text: 'bridge' }, 'bridge');
    assert.equal((await f.ext.mcp.approve(f.projectId, call.id, call.digest)).status, 'completed');
    assert.equal(remote.calls(), 1);
  } finally {
    await remote.close();
    await f.close();
  }
});
