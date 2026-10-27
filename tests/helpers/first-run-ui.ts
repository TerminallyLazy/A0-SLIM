/** Isolated first-run browser fixture. No external model or sandbox requests. */
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-onboard-ui-')));
const model = await startModelFixture({ tool: 'list_dir' });
const { app } = await createApp({
  dataDir: join(dir, 'data'),
  workspaceRoot: join(dir, 'My workspace'),
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'first-run-fixture',
  keySource: async () => Buffer.alloc(32, 7),
  staticDir: resolve('dist/ui'),
});
await app.listen({ host: '127.0.0.1', port: 4311 });
console.log(`First-run fixture ready; pairing: first-run-fixture; model: ${model.url}`);
const stop = async () => {
  await app.close();
  await model.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
