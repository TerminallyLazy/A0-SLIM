// Explicit local-only integration drill; not part of CI or npm test. No image pulls.
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/storage/store.js';
import { DockerSandbox } from '../../src/execution/docker.js';
import { Vault } from '../../src/providers/vault.js';
import { Coordinator } from '../../src/runtime/coordinator.js';
import { ChatGPTAccounts } from '../../src/providers/chatgpt.js';
import { startModelFixture } from './model-server.js';

const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-docker-live-'))),
  store = new Store(join(dir, 'data'));
const docker = new DockerSandbox(store),
  vault = new Vault(store, async () => Buffer.alloc(32, 2));
const runtime = new Coordinator(store, vault, new ChatGPTAccounts(store, vault));
const model = await startModelFixture({
  tool: 'run_javascript',
  toolInput: { code: 'process.stdout.write(String(6*7))' },
});
try {
  assert.equal(
    (await docker.availability()).available,
    true,
    'Start the local engine and install the pinned image first.',
  );
  const success = await docker.proof();
  assert.equal(success.status, 'passed');
  assert.equal(success.cleanup, 'removed');
  const isolation = await docker.run(
    "const fs=require('node:fs'),os=require('node:os');let readonly=false;try{fs.writeFileSync('/etc/a0-slim-test','no')}catch{readonly=true}process.stdout.write(JSON.stringify({uid:process.getuid(),readonly,externalInterfaces:Object.values(os.networkInterfaces()).flat().filter(i=>!i.internal).length,hostVisible:fs.existsSync('/Users'),secretPresent:!!process.env.A0_SLIM_VAULT_KEY}))",
  );
  assert.equal(isolation.status, 'passed');
  assert.deepEqual(JSON.parse(String(isolation.output)), {
    uid: 65534,
    readonly: true,
    externalInterfaces: 0,
    hostVisible: false,
    secretPresent: false,
  });
  assert.equal(isolation.cleanup, 'removed');
  const timeout = await docker.run('while(true){}');
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.cleanup, 'removed');
  const cancellation = await docker.run('setTimeout(()=>{},60000)', '', {
    signal: AbortSignal.timeout(800),
  });
  assert.equal(cancellation.status, 'failed');
  assert.equal(cancellation.cleanup, 'removed');
  const projectId = randomUUID(),
    connectionId = randomUUID(),
    chatId = randomUUID(),
    root = join(dir, 'project');
  await mkdir(root);
  store.saveProject({ id: projectId, name: 'Local sandbox fixture', root });
  store.saveConnection({
    id: connectionId,
    name: 'LOCAL TEST FIXTURE',
    kind: 'compatible',
    model: 'fixture',
    baseUrl: model.url,
    contextWindow: 32768,
    hasCredential: false,
    verifiedAt: null,
  });
  store.saveChat({
    id: chatId,
    title: 'Native Docker round trip',
    projectId,
    connectionId,
    model: 'fixture',
    sessionId: null,
    status: 'idle',
    execution: 'docker',
    createdAt: new Date().toISOString(),
  });
  await runtime.prompt(chatId, 'Compute six times seven in the local sandbox.', randomUUID());
  const deadline = Date.now() + 20000;
  while (store.chat(chatId).status === 'running' && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(store.chat(chatId).status, 'idle');
  const receipt = store.receipts().find((r) => r.projectId === projectId)!;
  assert.equal(receipt.output, '42');
  assert.equal(receipt.cleanup, 'removed');
  assert.equal(receipt.status, 'passed');
  console.log(
    JSON.stringify({
      checks: [
        'synthetic output',
        'non-root / read-only / no host mounts / no network / no app credentials',
        'timeout cleanup',
        'cancellation cleanup',
        'native model → Docker → result',
      ],
      receipts: store.receipts().length,
      unreconciled: store.receipts().filter((r) => r.cleanup === 'unknown').length,
    }),
  );
} finally {
  await runtime.close();
  await model.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}
