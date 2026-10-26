/** Opt-in local UI harness: fake Vercel peer and model; no cloud traffic or credentials. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from '../../src/storage/store.js';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
import { vercelFixture } from './vercel-execution.js';
process.umask(0o077);
const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-ui-')),
  root = join(dir, 'project');
await mkdir(root);
const model = await startModelFixture({
  tool: 'run_javascript',
  toolInput: { code: 'console.log(6 * 7)' },
});
let store!: Store;
const { dependencies } = vercelFixture(() => store);
const instance = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'vercel-fixture-only',
  staticDir: resolve('dist/ui'),
  keySource: async () => Buffer.alloc(32, 9),
  vercel: dependencies,
});
store = instance.store;
instance.runtime.docker.availability = async () => ({
  available: false,
  message: 'Docker is unavailable in this fixture.',
});
instance.runtime.docker.run = async () => {
  throw new Error('Docker is disabled in this fixture');
};
store.saveProject({ id: randomUUID(), name: 'Vercel UI fixture', root });
store.saveConnection({
  id: randomUUID(),
  name: 'Local test model',
  kind: 'compatible',
  model: 'fixture',
  baseUrl: model.url,
  contextWindow: 8192,
  hasCredential: false,
  verifiedAt: null,
});
store.setMeta('sandbox:vercel', 'configured');
store.receipt({
  id: randomUUID(),
  kind: 'vercel-sandbox-proof',
  status: 'passed',
  cleanup: 'deleted',
  startedAt: new Date().toISOString(),
  environmentId: 'synthetic-fixture',
  finishedAt: new Date().toISOString(),
});
await instance.vault.set('sandbox:vercel', {
  token: 'FAKE-UI-TOKEN',
  teamId: 'team_fixture',
  projectId: 'prj_fixture',
});
await instance.app.listen({ host: '127.0.0.1', port: 4311 });
console.log('Local Vercel UI fixture: http://127.0.0.1:4311 · pairing code vercel-fixture-only');
const stop = async () => {
  await instance.app.close();
  await model.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
