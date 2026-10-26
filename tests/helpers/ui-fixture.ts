/** Manual browser harness: isolated temporary data and a synthetic local model. */
import { realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
process.umask(0o077);
const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-ui-'))),
  root = join(dir, 'project');
await mkdir(root);
await writeFile(
  join(root, 'README.md'),
  '# Synthetic project\n\nThis browser check uses only a local model fixture.\n',
);
const fixture = await startModelFixture({
  tool: 'write_file',
  toolInput: {
    path: 'field-notes.md',
    content:
      '# A little room to think\n\nA synthetic artifact created in the local UI check.\n\n- Gather the notes.\n- Choose one clear next step.\n- Leave a trail for tomorrow.\n',
  },
  delayMs: 300,
});
const { app, store } = await createApp({
  dataDir: join(dir, 'data'),
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'local-fixture-only',
  keySource: async () => Buffer.alloc(32, 3),
  staticDir: resolve('dist/ui'),
});
store.saveProject({ id: randomUUID(), name: 'Synthetic project', root });
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
console.log('Synthetic UI harness: http://127.0.0.1:4311 · pairing code: local-fixture-only');
const stop = async () => {
  await app.close();
  await fixture.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
