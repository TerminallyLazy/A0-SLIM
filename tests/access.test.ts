import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/storage/store.js';
import { Access, accessRisk, defaultAccess, type AccessMode } from '../src/policy/access.js';
import { Operations } from '../src/policy/operations.js';
import { accessFileTools, accessPath } from '../src/tools/access-files.js';
import { webTool, privateAddress } from '../src/tools/web.js';
import { createApp } from '../src/server/app.js';
import { startModelFixture } from './helpers/model-server.js';
import { Vault } from '../src/providers/vault.js';
import { Extensions } from '../src/extensions/runtime.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('Timed out waiting for acceptance condition');
}
async function fixture(mode: AccessMode = 'auto') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-access-'))),
    root = join(dir, 'project');
  await mkdir(root);
  const store = new Store(join(dir, 'data')),
    access = new Access(store),
    projectId = randomUUID(),
    chatId = randomUUID();
  store.saveProject({ id: projectId, name: 'Fixture', root, access: { ...defaultAccess(), mode } });
  store.saveChat({
    id: chatId,
    projectId,
    title: 'Access fixture',
    connectionId: randomUUID(),
    model: 'fixture',
    sessionId: 'session',
    status: 'idle',
    createdAt: new Date().toISOString(),
    accessVersion: 1,
    capabilitiesVersion: 2,
    bashVersion: 1,
  });
  const context = (signal = new AbortController().signal) => {
    const messageId = randomUUID();
    access.capture(projectId, chatId, messageId);
    return {
      sessionId: 'session',
      executionId: randomUUID(),
      context: { messageId },
      signal,
    } as any;
  };
  return {
    dir,
    root,
    store,
    access,
    projectId,
    chatId,
    context,
    close: async () => {
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
async function mcpServer() {
  let calls = 0,
    changed = false,
    count = 2,
    fail = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(405).end();
      return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const b = JSON.parse(text);
    if (b.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (fail) {
      res.writeHead(401).end();
      return;
    }
    const result =
      b.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : b.method === 'tools/list'
          ? {
              tools: Array.from({ length: count }, (_, i) => ({
                name: `lookup_${i}`,
                description: `${changed ? 'Changed ' : ''}Synthetic lookup ${'x'.repeat(1600)}`,
                annotations: { readOnlyHint: true },
                inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
              })),
            }
          : (calls++, { content: [{ type: 'text', text: 'MCP fixture result' }] });
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    calls: () => calls,
    change: () => {
      changed = true;
      count = 3;
    },
    large: () => {
      count = 64;
    },
    fail: () => {
      fail = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

test('access modes implement the action matrix without trusting opaque tools', () => {
  assert.equal(defaultAccess().mode, 'auto');
  for (const kind of ['read', 'write', 'web', 'bash', 'mcp', 'acp'] as const)
    assert.equal(
      accessRisk('full', {
        kind,
        title: '',
        target: '',
        outside: true,
        sensitive: true,
        network: true,
      }),
      undefined,
    );
  for (const kind of ['read', 'write', 'web'] as const)
    assert.equal(
      accessRisk('auto', { kind, title: '', target: '', network: kind === 'web' }),
      undefined,
    );
  for (const mode of ['ask', 'auto'] as const) {
    assert.ok(accessRisk(mode, { kind: 'mcp', title: 'safe read-only!', target: '' }));
    assert.ok(accessRisk(mode, { kind: 'bash', title: 'safe command', target: '' }));
    assert.ok(accessRisk(mode, { kind: 'read', title: '', target: '', sensitive: true }));
    assert.ok(accessRisk(mode, { kind: 'write', title: '', target: '', outside: true }));
  }
  assert.equal(accessRisk('ask', { kind: 'read', title: '', target: '' }), undefined);
  assert.ok(accessRisk('ask', { kind: 'write', title: '', target: '' }));
  assert.ok(accessRisk('ask', { kind: 'web', title: '', target: '', network: true }));
});

test('automatic project writes retain atomic receipts; Full Access reaches external and hidden files', async () => {
  const f = await fixture();
  try {
    const operations = new Operations(f.store),
      tool = operations.tool(f.projectId, f.access),
      ctx = f.context();
    assert.equal(
      ((await tool.execute({ path: 'source.ts', content: 'export const value = 1;' }, ctx)) as any)
        .status,
      'applied',
    );
    assert.equal(
      ((await tool.execute({ path: 'source.ts', content: 'export const value = 1;' }, ctx)) as any)
        .status,
      'applied',
    );
    assert.equal(f.store.operations().length, 1);
    assert.equal(f.access.list().filter((d) => d.status === 'pending').length, 0);
    f.access.change(f.projectId, 'full');
    const outside = join(f.dir, '.env');
    assert.equal(
      ((await tool.execute({ path: outside, content: 'SYNTHETIC=yes' }, f.context())) as any)
        .status,
      'applied',
    );
    const read = accessFileTools(f.projectId, f.root, f.access)[0]!;
    assert.equal(await read.execute({ path: outside }, f.context()), 'SYNTHETIC=yes');
    assert.equal(
      await operations.readCurrent(f.store.operations().find((o) => o.path === outside)!.id),
      'SYNTHETIC=yes',
    );
    await symlink(outside, join(f.root, 'linked.txt'));
    assert.equal(await read.execute({ path: 'linked.txt' }, f.context()), 'SYNTHETIC=yes');
  } finally {
    await f.close();
  }
});

test('approval pauses a file write, rejects changed files and never follows a replaced target', async () => {
  const f = await fixture('ask');
  try {
    const operations = new Operations(f.store),
      tool = operations.tool(f.projectId, f.access);
    await writeFile(join(f.root, 'review.txt'), 'before');
    const work = Promise.resolve(
      tool.execute({ path: 'review.txt', content: 'after' }, f.context()),
    );
    const rejected = assert.rejects(work, /destination changed|approved path changed/);
    await until(() => f.access.list().some((d) => d.status === 'pending'));
    assert.equal(await readFile(join(f.root, 'review.txt'), 'utf8'), 'before');
    const d = f.access.list()[0]!;
    assert.throws(() => f.access.decide(d.id, '0'.repeat(64), true), /no longer matches/);
    await rm(join(f.root, 'review.txt'));
    await writeFile(join(f.dir, 'outside.txt'), 'untouched');
    await symlink(join(f.dir, 'outside.txt'), join(f.root, 'review.txt'));
    f.access.decide(d.id, d.digest, true);
    await rejected;
    await assert.rejects(
      operations.readCurrent(f.store.operations()[0]!.id),
      /recorded path changed/,
    );
    assert.equal(await readFile(join(f.dir, 'outside.txt'), 'utf8'), 'untouched');
  } finally {
    await f.close();
  }
});

test('denial, Stop, access changes and restart invalidate pending authority', async () => {
  const f = await fixture('ask');
  try {
    const action = { kind: 'write' as const, title: 'Edit', target: 'fixture.txt' };
    for (const outcome of ['deny', 'stop', 'change'] as const) {
      const controller = new AbortController(),
        context = f.access.context(f.projectId, f.context(controller.signal));
      const work = f.access.authorize(context, action),
        rejected = assert.rejects(work);
      await until(() => f.access.list().some((d) => d.status === 'pending'));
      const d = f.access.list().find((d) => d.status === 'pending')!;
      if (outcome === 'deny') f.access.decide(d.id, d.digest, false);
      if (outcome === 'stop') controller.abort();
      if (outcome === 'change') f.access.change(f.projectId, 'auto');
      await rejected;
      await assert.rejects(f.access.authorize(context, action));
      f.access.change(f.projectId, 'ask');
    }
    const last = f.access.list()[0]!;
    f.store.record('access-decision', { ...last, id: randomUUID(), status: 'pending' });
    const reopened = new Access(f.store);
    assert.ok(reopened.list().every((d) => d.status !== 'pending'));
  } finally {
    await f.close();
  }
});

test('MCP setup discovers and enables tools once; refresh preserves opt-outs and failed connections stay disabled', async () => {
  const f = await fixture(),
    peer = await mcpServer(),
    ext = new Extensions(f.store, new Vault(f.store, async () => Buffer.alloc(32, 4)), f.access);
  try {
    const s = await ext.mcp.setup(f.projectId, {
      name: 'Fixture',
      transport: 'http',
      url: peer.url,
    });
    assert.equal(s.enabled, true);
    assert.deepEqual(s.allowed, ['lookup_0', 'lookup_1']);
    assert.equal(peer.calls(), 0);
    ext.mcp.configure(f.projectId, s.id, true, ['lookup_0']);
    peer.change();
    const changed = await ext.mcp.discover(f.projectId, s.id);
    assert.deepEqual(changed.allowed, ['lookup_0', 'lookup_2']);
    ext.mcp.configure(f.projectId, s.id, false, changed.allowed);
    assert.equal((await ext.mcp.discover(f.projectId, s.id)).enabled, false);
    peer.fail();
    const failed = await ext.mcp.setup(f.projectId, {
      name: 'Failed',
      transport: 'http',
      url: peer.url,
    });
    assert.equal(failed.enabled, false);
    assert.ok(failed.connectionError);
    assert.equal(failed.tools.length, 0);
  } finally {
    await ext.close();
    await peer.close();
    await f.close();
  }
});

test('large auto-enabled MCP catalogs use compact snapshots and on-demand schemas', async () => {
  const f = await fixture(),
    peer = await mcpServer(),
    ext = new Extensions(f.store, new Vault(f.store, async () => Buffer.alloc(32, 4)), f.access);
  try {
    peer.large();
    const server = await ext.mcp.setup(f.projectId, {
      name: 'Large',
      transport: 'http',
      url: peer.url,
    });
    assert.equal(server.allowed.length, 64);
    const ctx = f.context(),
      snapshot = ext.snapshot(f.projectId, f.chatId, ctx.context.messageId, 'Find tools');
    assert.ok(ext.instructions(snapshot).length < 10000);
    const tools = ext.tools(f.projectId, true),
      catalog = tools.find((t) => t.name === 'mcp_tools')!;
    const page = (await catalog.execute(
      { serverId: server.id, query: 'lookup_63', schema: true },
      ctx,
    )) as any;
    assert.equal(page.tools[0].name, 'lookup_63');
    assert.ok(page.tools[0].inputSchema);
  } finally {
    await ext.close();
    await peer.close();
    await f.close();
  }
});

test('web fetch pins resolved destinations, asks before private network access and bounds responses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    assert.equal(privateAddress(address), true, address);
  assert.equal(privateAddress('93.184.216.34'), false);
  const f = await fixture(),
    server = createServer((req, res) => {
      calls++;
      res.end(req.url === '/large' ? 'x'.repeat(300000) : 'Synthetic webpage');
    });
  let calls = 0;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  try {
    const tool = webTool(f.projectId, f.access),
      work = tool.execute({ url }, f.context());
    await until(() => f.access.list().some((d) => d.status === 'pending'));
    assert.equal(calls, 0);
    const d = f.access.list().find((d) => d.status === 'pending')!;
    f.access.decide(d.id, d.digest, true);
    assert.equal(((await work) as any).text, 'Synthetic webpage');
    assert.equal(calls, 1);
    f.access.change(f.projectId, 'full');
    assert.equal(((await tool.execute({ url }, f.context())) as any).status, 200);
    assert.equal(calls, 2);
    await assert.rejects(
      Promise.resolve(tool.execute({ url: url + 'large' }, f.context())),
      /256 KiB/,
    );
    await assert.rejects(Promise.resolve(tool.execute({ url: 'file:///etc/hosts' }, f.context())));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});

for (const [kind, mode, approval] of [
  ['write_file', 'ask', true],
  ['mcp_call', 'auto', true],
  ['bash', 'auto', true],
  ['write_file', 'full', false],
  ['mcp_call', 'full', false],
  ['bash', 'full', false],
  ['write_file', 'auto', false],
] as const)
  test(
    `native ${kind} in ${mode} executes once and continues ${approval ? 'after approval' : 'automatically'}`,
    { timeout: 15000 },
    async () => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-access-native-'))),
        root = join(dir, 'project');
      await mkdir(root);
      const peer = await mcpServer();
      const options: any = {
        tool: kind,
        toolInput:
          kind === 'write_file'
            ? { path: 'result.txt', content: 'approved' }
            : kind === 'bash'
              ? { command: "printf 'approved' > result.txt", target: 'host' }
              : {},
        maxRequests: 5,
      };
      const model = await startModelFixture(options);
      const { app, store, runtime } = await createApp({
        dataDir: join(dir, 'data'),
        origin: 'http://127.0.0.1:4310',
        pairingCode: 'fixture',
        keySource: async () => Buffer.alloc(32, 8),
      });
      let cookie = '';
      const call = (path: string, body?: unknown) =>
        app.inject({
          method: body === undefined ? 'GET' : 'POST',
          url: `/api/v1${path}`,
          headers: {
            host: '127.0.0.1:4310',
            origin: 'http://127.0.0.1:4310',
            cookie,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          payload: body === undefined ? undefined : JSON.stringify(body),
        });
      try {
        cookie = String((await call('/pair', { code: 'fixture' })).headers['set-cookie']).split(
          ';',
        )[0]!;
        const project = (await call('/projects', { name: 'Fixture', root })).json();
        assert.equal(project.access.mode, 'auto');
        if (mode !== 'auto')
          assert.equal((await call(`/projects/${project.id}/access`, { mode })).statusCode, 200);
        const connection = (
          await call('/connections', {
            name: 'Model',
            kind: 'compatible',
            model: 'fixture',
            baseUrl: model.url,
          })
        ).json();
        if (kind === 'mcp_call') {
          const server = (
            await call(`/projects/${project.id}/mcp`, {
              name: 'MCP',
              transport: 'http',
              url: peer.url,
            })
          ).json();
          assert.equal(server.enabled, true);
          options.toolInput = {
            serverId: server.id,
            tool: 'lookup_0',
            arguments: { text: 'synthetic' },
          };
        }
        const chat = (
          await call('/chats', {
            projectId: project.id,
            connectionId: connection.id,
            title: 'Fixture',
          })
        ).json();
        assert.equal(chat.accessVersion, 1);
        await call(`/chats/${chat.id}/messages`, {
          text: 'Perform the synthetic acceptance action.',
          messageId: randomUUID(),
        });
        if (approval) {
          await until(() => runtime.access.list().some((d) => d.status === 'pending'));
          assert.equal(store.chat(chat.id).status, 'running');
          assert.equal(model.requests.length, 1);
          assert.equal(peer.calls(), 0);
          await assert.rejects(readFile(join(root, 'result.txt')));
          const d = (await call('/state')).json().accessDecisions[0];
          if (kind === 'write_file') {
            assert.equal(
              (await call(`/artifacts/${randomUUID()}/apply`, { digest: d.action.fingerprint }))
                .statusCode,
              404,
            );
            assert.equal(runtime.access.list().find((item) => item.id === d.id)?.status, 'pending');
          }
          assert.equal(
            (await call(`/access-decisions/${d.id}`, { digest: '0'.repeat(64), allow: true }))
              .statusCode,
            409,
          );
          assert.equal(
            (await call(`/access-decisions/${d.id}`, { digest: d.digest, allow: true })).statusCode,
            200,
          );
          assert.equal(
            (await call(`/access-decisions/${d.id}`, { digest: d.digest, allow: true })).statusCode,
            200,
          );
        }
        await until(() => store.chat(chat.id).status === 'idle');
        assert.equal(model.requests.length, 2);
        if (kind === 'mcp_call') assert.equal(peer.calls(), 1);
        else assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'approved');
        if (kind === 'write_file') {
          const operation = store.operations()[0]!;
          assert.equal((await call(`/artifacts/${operation.id}/current`)).json().text, 'approved');
        }
        assert.ok(model.requests[1]!.messages.some((m) => m.role === 'tool'));
        if (approval) {
          await call(`/chats/${chat.id}/messages`, {
            text: 'A second synthetic action to test cancellation.',
            messageId: randomUUID(),
          });
          await until(() => runtime.access.list().some((d) => d.status === 'pending'));
          if (kind === 'mcp_call') await call(`/projects/${project.id}/access`, { mode: 'full' });
          else await call(`/chats/${chat.id}/cancel`, {});
          await until(() => store.chat(chat.id).status !== 'running');
          assert.equal(runtime.access.list().filter((d) => d.status === 'pending').length, 0);
          if (kind === 'mcp_call') assert.equal(peer.calls(), 1);
          else assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'approved');
        }
      } finally {
        await app.close();
        await model.close();
        await peer.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

test('sensitive-path checks respect an explicitly selected project inside a Codex worktree', async () => {
  const f = await fixture();
  try {
    const root = join(f.dir, '.codex/worktrees/project');
    await mkdir(root, { recursive: true });
    assert.equal((await accessPath(root, 'normal.txt', true)).sensitive, false);
    assert.equal((await accessPath(root, '.env', true)).sensitive, true);
    assert.equal((await accessPath(root, join(f.dir, '.env'), true)).outside, true);
  } finally {
    await f.close();
  }
});

for (const change of ['disable', 'definition'] as const)
  test(`MCP ${change} cancels a pending inline decision without dispatch`, async () => {
    const f = await fixture(),
      peer = await mcpServer();
    const ext = new Extensions(
      f.store,
      new Vault(f.store, async () => Buffer.alloc(32, 4)),
      f.access,
    );
    try {
      const server = await ext.mcp.setup(f.projectId, {
        name: 'MCP',
        transport: 'http',
        url: peer.url,
      });
      const ctx = f.context();
      ext.snapshot(f.projectId, f.chatId, ctx.context.messageId, 'Synthetic call');
      const tool = ext.tools(f.projectId, true).find((t) => t.name === 'mcp_call')!;
      const work = Promise.resolve(
        tool.execute({ serverId: server.id, tool: 'lookup_0', arguments: {} }, ctx),
      );
      const rejected = assert.rejects(work, /denied|cancelled/);
      await until(() => f.access.list().some((d) => d.status === 'pending'));
      if (change === 'disable') ext.mcp.configure(f.projectId, server.id, false, server.allowed);
      else {
        peer.change();
        await ext.mcp.discover(f.projectId, server.id);
      }
      await rejected;
      assert.equal(peer.calls(), 0);
      assert.equal(f.access.list().filter((d) => d.status === 'pending').length, 0);
    } finally {
      await ext.close();
      await peer.close();
      await f.close();
    }
  });

test(
  'external file application is serialized across projects sharing the same destination',
  { timeout: 5000 },
  async () => {
    const f = await fixture('full');
    let finish!: () => void, started!: () => void;
    const hold = new Promise<void>((r) => {
        finish = r;
      }),
      writing = new Promise<void>((r) => {
        started = r;
      });
    try {
      const operations = new Operations(f.store, async () => {
        started();
        await hold;
      });
      const target = join(f.dir, 'shared.txt');
      await writeFile(target, 'original');
      const other = randomUUID(),
        chat = randomUUID();
      f.store.saveProject({ ...f.store.project(f.projectId), id: other });
      f.store.saveChat({
        ...f.store.chat(f.chatId),
        id: chat,
        projectId: other,
        sessionId: 'second',
      });
      const a = await operations.propose(f.projectId, 'session', 'a', 'turn-a', {
        path: target,
        content: 'original',
      });
      const b = await operations.propose(other, 'second', 'b', 'turn-b', {
        path: target,
        content: 'updated',
      });
      const first = operations.apply(a.id, a.digest);
      await writing;
      await assert.rejects(operations.apply(b.id, b.digest), /Another project/);
      finish();
      await first;
      assert.equal((await operations.apply(b.id, b.digest)).status, 'applied');
      assert.equal(await readFile(target, 'utf8'), 'updated');
    } finally {
      finish?.();
      await f.close();
    }
  },
);
