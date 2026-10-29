// Opt-in: downloads the pinned Python runtime, wheels and actual DB Hub sources.
// No Agent Zero host, checkout, model account or system Python is used.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startModelFixture } from './model-server.js';
if (!process.argv.includes('--download'))
  throw new Error(
    'Pass --download to explicitly download the optional runtime and public plugin source.',
  );
const packageIndex = process.argv.indexOf('--package-dir');
const packageDir = packageIndex === -1 ? undefined : process.argv[packageIndex + 1];
assert.ok(packageIndex === -1 || (packageDir && !packageDir.startsWith('--')));
const { createApp } = (await import(
  packageDir
    ? pathToFileURL(join(resolve(packageDir), 'dist/server/server/app.js')).href
    : '../../src/server/app.js'
)) as typeof import('../../src/server/app.js');
const { runWorkerProcess, workerSource } = (await import(
  packageDir
    ? pathToFileURL(join(resolve(packageDir), 'dist/server/extensions/native-plugins.js')).href
    : '../../src/extensions/native-plugins.js'
)) as typeof import('../../src/extensions/native-plugins.js');
if (packageDir)
  assert.equal(workerSource, await realpath(join(resolve(packageDir), 'addons/plugin-worker')));
const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-native-plugin-')));
console.log('Native plugin proof directory:', dir);
const root = join(dir, 'project');
await mkdir(root);
const options = {
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4310',
  pairingCode: 'fixture',
  keySource: async () => Buffer.alloc(32, 7),
};
let instance = await createApp(options);
let model: Awaited<ReturnType<typeof startModelFixture>> | undefined;
let passed = false;
try {
  const projectId = randomUUID();
  instance.store.saveProject({ id: projectId, name: 'Independent plugin proof', root });
  await instance.runtime.extensions.plugins.start();
  let state = await instance.runtime.extensions.plugins.state();
  while (state.status === 'installing') {
    await new Promise((r) => setTimeout(r, 500));
    state = await instance.runtime.extensions.plugins.state();
  }
  assert.equal(state.status, 'ready', state.error);
  const { readdir } = await import('node:fs/promises');
  const runtimeRoot = join(
    options.dataDir,
    'addons/plugin-worker',
    (await readdir(join(options.dataDir, 'addons/plugin-worker'))).find((n) =>
      /^[a-f0-9]{64}$/.test(n),
    )!,
  );
  const python = join(runtimeRoot, 'python/bin/python3');
  await runWorkerProcess(
    python,
    [
      '-I',
      '-B',
      '-c',
      'import sqlite3,sys,importlib.util; assert importlib.util.find_spec("agent") is None; db=sqlite3.connect(sys.argv[1]); db.execute("create table synthetic_inventory (id integer primary key, label text not null)"); db.commit(); db.close()',
      join(root, 'fixture.sqlite'),
    ],
    root,
    AbortSignal.timeout(10_000),
  );
  const before = await readFile(join(root, 'fixture.sqlite'));
  const configured = await instance.runtime.extensions.plugins.configure(projectId, {
    database: 'fixture.sqlite',
    acknowledgeHostExecution: true,
  });
  assert.equal(configured.binding?.enabled, true);
  const serverId = configured.binding!.serverId;
  let mcp = instance.runtime.extensions.mcp;
  assert.deepEqual(
    mcp
      .list(projectId)[0]!
      .tools.map((t) => t.name)
      .sort(),
    ['db_hub_schema', 'db_hub_status'],
  );
  model = await startModelFixture({
    tool: 'mcp_call',
    toolInput: { serverId, tool: 'db_hub_schema', arguments: {} },
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
    title: 'Independent plugin proof',
    projectId,
    connectionId,
    model: 'fixture',
    sessionId: null,
    capabilitiesVersion: 2,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  await instance.runtime.prompt(chatId, 'Inspect the synthetic database schema.', randomUUID());
  for (let i = 0; i < 500 && instance.store.chat(chatId).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  const staged = mcp.calls(projectId)[0]!;
  assert.equal(staged.status, 'pending');
  const done = await mcp.approve(projectId, staged.id, staged.digest);
  assert.equal(done.status, 'completed');
  assert.match(done.result!, /synthetic_inventory/);
  assert.equal((await mcp.approve(projectId, staged.id, staged.digest)).result, done.result);
  const status = mcp.stage(projectId, serverId, 'db_hub_status', {}, 'independent-status');
  const statusDone = await mcp.approve(projectId, status.id, status.digest);
  assert.equal(statusDone.status, 'completed');
  assert.match(statusDone.result!, /\\?"ok\\?"\s*:\s*true/);
  // New chats use inline access decisions and continue the same model turn.
  instance.store.saveProject({
    ...instance.store.project(projectId),
    access: { mode: 'ask', revision: randomUUID() },
  });
  const currentChatId = randomUUID();
  instance.store.saveChat({
    ...instance.store.chat(chatId),
    id: currentChatId,
    title: 'Current native plugin proof',
    sessionId: null,
    accessVersion: 1,
  });
  await instance.runtime.prompt(currentChatId, 'Inspect the synthetic schema.', randomUUID());
  for (
    let i = 0;
    i < 500 && !instance.runtime.access.list().some((d) => d.status === 'pending');
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  const decision = instance.runtime.access.list().find((d) => d.status === 'pending');
  assert.ok(decision);
  assert.equal(instance.store.chat(currentChatId).status, 'running');
  instance.runtime.access.decide(decision.id, decision.digest, true);
  for (let i = 0; i < 500 && instance.store.chat(currentChatId).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(instance.store.chat(currentChatId).status, 'idle');
  const inlineCall = mcp.calls(projectId).find((c) => ![staged.id, status.id].includes(c.id))!;
  assert.equal(inlineCall.status, 'completed');
  assert.match(inlineCall.result!, /synthetic_inventory/);
  assert.ok(model.requests.at(-1)?.messages.some((m) => m.role === 'tool'));
  await instance.app.close();
  instance = await createApp(options);
  mcp = instance.runtime.extensions.mcp;
  assert.equal((await mcp.approve(projectId, staged.id, staged.digest)).result, done.result);
  const columns = mcp.stage(
    projectId,
    serverId,
    'db_hub_schema',
    { target: 'synthetic_inventory' },
    'columns-after-restart',
  );
  const columnsDone = await mcp.approve(projectId, columns.id, columns.digest);
  assert.equal(columnsDone.status, 'completed');
  assert.match(columnsDone.result!, /label/);
  assert.deepEqual(await readFile(join(root, 'fixture.sqlite')), before);
  const original = mcp.list(projectId).find((s) => s.id === serverId)!;
  const alias = await mcp.add(projectId, {
    name: 'Synthetic alias',
    transport: 'stdio',
    command: original.command,
    args: original.args,
    acknowledgeHostExecution: true,
  });
  const aliasTools = await mcp.discover(projectId, alias.id);
  mcp.configure(
    projectId,
    alias.id,
    true,
    aliasTools.tools.map((t) => t.name),
  );
  const uncertain = mcp.stage(projectId, alias.id, 'db_hub_status', {}, 'simulated-lost-dispatch');
  // Synthetic lost-outcome fixture: the real worker has no dispatched receipt.
  instance.store.record('mcp-call', { ...uncertain, status: 'unknown' });
  assert.equal(
    (await instance.runtime.extensions.plugins.projectState(projectId)).unresolved.length,
    1,
  );
  await assert.rejects(
    instance.runtime.extensions.plugins.configure(projectId, {
      database: 'fixture.sqlite',
      acknowledgeHostExecution: true,
    }),
    /unfinished/,
  );
  await instance.runtime.extensions.plugins.reconcile(projectId, {
    operationId: uncertain.id,
    resolution: 'Synthetic fixture: no dispatch occurred; worker receipt is absent.',
  });
  assert.equal(
    (await instance.runtime.extensions.plugins.projectState(projectId)).unresolved.length,
    0,
  );
  await mcp.remove(projectId, alias.id);
  await instance.runtime.extensions.plugins.disable(projectId);
  assert.throws(() => mcp.stage(projectId, serverId, 'db_hub_status', {}, 'disabled'));
  console.log(
    JSON.stringify(
      {
        evidence:
          'Actual pinned DB Hub Python tools, downloaded independent Python runtime, synthetic model and SQLite fixture. No Agent Zero installation.',
        distribution: packageDir ? 'installed npm tarball' : 'source checkout',
        pluginCommit: configured.recipe.commit,
        runtime: state.version,
        operations: [staged.id, status.id, inlineCall.id, columns.id],
        schema: JSON.parse(JSON.parse(done.result!).output).schema,
        unchangedDatabase: true,
        restartReceiptReuse: true,
        aliasConfigurationHold: true,
        inlineApprovalContinuation: true,
      },
      null,
      2,
    ),
  );
  passed = true;
} finally {
  await instance.app.close();
  await model?.close();
  if (passed && !process.argv.includes('--keep')) await rm(dir, { recursive: true, force: true });
}
