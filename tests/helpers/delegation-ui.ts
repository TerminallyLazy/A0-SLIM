/** Manual browser check using disposable data and a local synthetic model. */
import { realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { delegationModel } from './delegation-model.js';
process.umask(0o077);
const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-delegation-ui-'))),
  root = join(dir, 'project');
await mkdir(root);
await writeFile(join(root, 'note.txt'), 'Paper Garden\n');
const fixture = await delegationModel();
const { app, store } = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'local-fixture-only',
  keySource: async () => Buffer.alloc(32, 3),
  staticDir: resolve('dist/ui'),
});
store.saveProject({ id: randomUUID(), name: 'Paper Garden · UI fixture', root });
store.saveConnection({
  id: randomUUID(),
  name: 'LOCAL TEST FIXTURE',
  kind: 'compatible',
  model: 'fixture',
  baseUrl: fixture.url,
  contextWindow: 8192,
  hasCredential: false,
  verifiedAt: null,
});
await app.listen({ host: '127.0.0.1', port: 4311 });
console.log('Synthetic UI: http://127.0.0.1:4311 · code: local-fixture-only');
const stop = async () => {
  await app.close();
  await fixture.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
