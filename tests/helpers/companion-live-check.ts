// Opt-in real plugin check. Requires the disposable offline host configured by companion-host-fixture.py.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
const container = process.argv[2];
if (!container || !/^a0-slim-plugin-proof-[a-z0-9-]+$/.test(container))
  throw new Error('Pass the explicit disposable proof container name.');
const dir = await mkdtemp(join(tmpdir(), 'slim-companion-'));
const root = join(dir, 'project');
await mkdir(root);
const instance = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4310',
  pairingCode: 'fixture',
  keySource: async () => Buffer.alloc(32, 7),
});
const projectId = randomUUID();
let model: Awaited<ReturnType<typeof startModelFixture>> | undefined;
try {
  instance.store.saveProject({ id: projectId, name: 'Synthetic companion proof', root });
  const mcp = instance.runtime.extensions.mcp;
  const server = await mcp.add(projectId, {
    name: 'Real pinned DB Hub in offline fixture',
    transport: 'stdio',
    command: '/usr/local/bin/docker',
    args: [
      'exec',
      '-i',
      '-w',
      '/slim-a0',
      container,
      '/opt/venv-a0/bin/python',
      '-m',
      'usr.plugins.slim_tools_bridge.server',
      '--binding',
      '/slim-a0/usr/slim-tools-fixture.json',
    ],
    acknowledgeHostExecution: true,
  });
  const found = await mcp.discover(projectId, server.id);
  assert.deepEqual(found.tools.map((t) => t.name).sort(), [
    'a0_db_hub_db_schema',
    'a0_db_hub_db_status',
  ]);
  mcp.configure(
    projectId,
    server.id,
    true,
    found.tools.map((t) => t.name),
  );
  model = await startModelFixture({
    tool: 'mcp_call',
    toolInput: {
      serverId: server.id,
      tool: 'a0_db_hub_db_schema',
      arguments: { connection: 'fixture' },
    },
  });
  const connectionId = randomUUID(),
    chatId = randomUUID();
  instance.store.saveConnection({
    id: connectionId,
    name: 'Synthetic model',
    kind: 'compatible',
    model: 'fixture',
    baseUrl: model.url,
    contextWindow: 8192,
    hasCredential: false,
    verifiedAt: null,
  });
  instance.store.saveChat({
    id: chatId,
    title: 'DB Hub native proof',
    projectId,
    connectionId,
    model: 'fixture',
    sessionId: null,
    capabilitiesVersion: 2,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  await instance.runtime.prompt(
    chatId,
    'Inspect the synthetic schema using the approved companion.',
    randomUUID(),
  );
  for (let i = 0; i < 500 && instance.store.chat(chatId).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(instance.store.chat(chatId).status, 'idle');
  const staged = mcp.calls(projectId)[0]!;
  assert.equal(staged.status, 'pending');
  const done = await mcp.approve(projectId, staged.id, staged.digest);
  assert.equal(done.status, 'completed');
  assert.match(done.result!, /synthetic_inventory/);
  assert.equal((await mcp.approve(projectId, staged.id, staged.digest)).result, done.result);
  const status = mcp.stage(
    projectId,
    server.id,
    'a0_db_hub_db_status',
    { connection: 'fixture' },
    'status-proof',
  );
  const statusDone = await mcp.approve(projectId, status.id, status.digest);
  assert.equal(statusDone.status, 'completed');
  assert.match(statusDone.result!, /\\?"ok\\?"\s*:\s*true/);
  console.log(
    JSON.stringify(
      {
        evidence: 'real DB Hub Python tools; synthetic model and SQLite data; offline container',
        operations: [staged.id, status.id],
        schema: JSON.parse(JSON.parse(done.result!).output).schema,
        status: JSON.parse(JSON.parse(statusDone.result!).output).results,
        serverVersion: found.serverVersion,
      },
      null,
      2,
    ),
  );
} finally {
  await instance.app.close();
  await model?.close();
  await rm(dir, { recursive: true, force: true });
}
