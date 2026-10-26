// Explicit local acceptance: downloads the optional runtime/image and starts bounded microVMs.
// Never included in the default test glob or CI. Uses a local model fixture, no live model account.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { Microsandbox, type MicroReceipt } from '../../src/execution/microsandbox.js';
import { microRuntimeHome } from '../../src/execution/microsandbox-addon.js';
import { startModelFixture } from './model-server.js';

const dir = await mkdtemp(join(tmpdir(), 'slim-micro-live-')),
  root = join(dir, 'project');
await mkdir(root);
const canary = join(root, 'host-only.txt');
await writeFile(canary, 'synthetic host canary');
process.env.A0_MICRO_TEST_SENTINEL = 'synthetic-host-only';
const code = `const fs=require('node:fs'),net=require('node:net');if(fs.existsSync(${JSON.stringify(canary)})||process.env.A0_MICRO_TEST_SENTINEL)throw Error('host isolation failed');const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(500);s.once('connect',()=>{console.error('network unexpectedly enabled');process.exit(1)});let done=false;function finish(){if(done)return;done=true;s.destroy();console.log(Number(fs.readFileSync(0,'utf8'))+2)}s.once('error',finish);s.once('timeout',finish);`;
const model = await startModelFixture({
  tool: 'run_javascript',
  toolInput: { code, input: '40' },
  maxRequests: 3,
});
const { app, store, runtime } = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4310',
  pairingCode: 'fixture',
  keySource: async () => Buffer.alloc(32, 3),
});
const micro = runtime.microsandbox;
const home = microRuntimeHome(micro.addon.home);
let cookie = '',
  accepted = false;
async function call(path: string, payload?: Record<string, unknown>) {
  const r = await app.inject({
    method: payload === undefined ? 'GET' : 'POST',
    url: '/api/v1' + path,
    headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310', cookie },
    ...(payload === undefined ? {} : { payload }),
  });
  assert.ok(r.statusCode < 300, `${path}: ${r.body}`);
  return r;
}
try {
  cookie = String((await call('/pair', { code: 'fixture' })).headers['set-cookie']).split(';')[0]!;
  await call('/sandbox/microsandbox/install', { acknowledgeDownload: true });
  await micro.addon.settled();
  assert.equal(
    (await micro.state()).runtime.status,
    'installed',
    JSON.stringify(await micro.state()),
  );
  const proof = (await call('/sandbox/microsandbox/proof', {})).json();
  assert.equal(proof.status, 'passed', JSON.stringify(proof));
  assert.equal(proof.cleanup, 'deleted');
  const project = (await call('/projects', { name: 'Microsandbox local acceptance', root })).json();
  await call(`/projects/${project.id}/execution`, { execution: 'microsandbox' });
  const connection = (
    await call('/connections', {
      name: 'Local fixture',
      kind: 'compatible',
      baseUrl: model.url,
      model: 'fixture',
    })
  ).json();
  const chat = (
    await call('/chats', {
      projectId: project.id,
      connectionId: connection.id,
      title: 'Local microVM check',
    })
  ).json();
  const messageId = randomUUID();
  await call(`/chats/${chat.id}/messages`, { text: 'Run the synthetic check.', messageId });
  for (let i = 0; i < 600 && store.chat(chat.id).status === 'running'; i++)
    await new Promise((r) => setTimeout(r, 100));
  const receipt = store
    .receipts()
    .find((r) => r.kind === 'microsandbox-execution' && r.chatId === chat.id)!;
  assert.equal(receipt?.status, 'passed', JSON.stringify(receipt));
  assert.equal(receipt.output, '42\n');
  assert.equal(receipt.cleanup, 'deleted');
  assert.equal(store.chat(chat.id).status, 'idle');
  const context = {
    projectId: project.id,
    sessionId: store.chat(chat.id).sessionId!,
    messageId: randomUUID(),
    callId: randomUUID(),
  };
  const timeout = await micro.run({ code: 'while(true){}' }, context);
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.exitCode, 124);
  assert.equal(timeout.cleanup, 'deleted');
  const overflow = await micro.run(
    { code: "process.stdout.write('x'.repeat(200000))" },
    { ...context, messageId: randomUUID(), callId: randomUUID() },
  );
  assert.equal(overflow.status, 'failed');
  assert.equal(overflow.cleanup, 'deleted');
  const abort = new AbortController();
  const canceled = micro.run(
    { code: 'setTimeout(()=>console.log(42),30000)' },
    { ...context, messageId: randomUUID(), callId: randomUUID(), signal: abort.signal },
  );
  for (let i = 0; i < 200 && !store.receipts()[0]?.sandboxId; i++)
    await new Promise((r) => setTimeout(r, 20));
  // Allow creation to settle before interrupting the command.
  await new Promise((r) => setTimeout(r, 1000));
  abort.abort();
  assert.equal((await canceled).cleanup, 'deleted');
  const id = randomUUID();
  const interrupted: MicroReceipt = {
    id,
    kind: 'microsandbox-execution',
    name: `a0-slim-${id}`,
    hostId: store.meta('host_id')!,
    runtimeId: proof.runtimeId,
    revision: await micro.addon.fingerprint(),
    status: 'pending',
    cleanup: 'unknown',
    startedAt: new Date().toISOString(),
  };
  store.receipt(interrupted);
  await assert.rejects(
    micro.addon.call(
      {
        action: 'run',
        name: interrupted.name,
        receiptId: id,
        hostId: interrupted.hostId,
        runtimeId: interrupted.runtimeId,
        code: 'console.log("must not execute")',
      },
      undefined,
      (sandboxId) => {
        interrupted.sandboxId = sandboxId;
        store.receipt(interrupted);
        throw Error('Synthetic worker interruption before command acknowledgment');
      },
    ),
    /Synthetic worker interruption/,
  );
  const restarted = new Microsandbox(store, micro.addon);
  assert.equal((await restarted.state()).activity, 'unknown');
  assert.equal((await restarted.reconcile(id)).cleanup, 'deleted');
  await restarted.check();
  assert.equal((await restarted.state()).available, true);
  assert.ok(store.receipts().every((r) => r.cleanup === 'deleted'));
  const packed = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    microsandbox: '0.7.11',
    checks: [
      'optional setup',
      'pinned image',
      'synthetic file check',
      'native chat tool round trip',
      'host file and credential isolation',
      'guest network denied',
      'code timeout',
      'output limit',
      'cancellation cleanup',
      'worker interruption and restart reconciliation',
    ],
    receiptCount: store.receipts().length,
    allDeleted: true,
  };
  console.log(JSON.stringify(packed, null, 2));
  accepted = true;
} finally {
  await app.close();
  await model.close();
  delete process.env.A0_MICRO_TEST_SENTINEL;
  if (accepted) {
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  } else console.error(`Validation data retained for recovery: ${dir}`);
}
