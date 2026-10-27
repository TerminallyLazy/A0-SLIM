/** Manual browser check with synthetic local data and a local model fixture. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
const dir = await mkdtemp(join(tmpdir(), 'slim-bash-ui-')),
  root = join(dir, 'project');
await mkdir(root);
const fixture = await startModelFixture({
  tool: 'bash',
  toolInput: {
    command: "printf 'Paper Garden\\n'; printf 'Synthetic stderr\\n' >&2",
    target: 'host',
  },
});
const { app, store, runtime } = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'bash-fixture-only',
  staticDir: resolve('dist/ui'),
  keySource: async () => Buffer.alloc(32, 2),
});
store.saveProject({ id: randomUUID(), name: 'Bash UI fixture', root });
// Test-only grant for this fixture's fixed synthetic command. No user project is modified.
await runtime.bash.authorize(store.projects()[0]!.id);
store.saveConnection({
  id: randomUUID(),
  name: 'Local fixture',
  kind: 'compatible',
  model: 'fixture',
  baseUrl: fixture.url,
  contextWindow: 8192,
  hasCredential: false,
  verifiedAt: null,
});
await app.listen({ host: '127.0.0.1', port: 4311 });
console.log('Bash fixture: http://127.0.0.1:4311 · pair with bash-fixture-only');
const stop = async () => {
  await app.close();
  await fixture.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
