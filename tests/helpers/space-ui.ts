/** Opt-in browser harness. Local HTTP fixtures only; no real SPACE resources or credentials. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { fixture } from './space-server.js';
process.umask(0o077);
const dir = await mkdtemp(join(tmpdir(), 'slim-space-ui-'));
const app = await createApp({
  dataDir: dir,
  origin: 'http://127.0.0.1:4311',
  pairingCode: 'space-fixture-only',
  staticDir: resolve('dist/ui'),
  keySource: async () => Buffer.alloc(32, 8),
});
const server = await fixture({ store: app.store, vault: app.vault, service: app.space });
await app.app.listen({ host: '127.0.0.1', port: 4311 });
console.log('SPACE UI fixture: http://127.0.0.1:4311 · pairing code space-fixture-only');
const stop = async () => {
  await app.space.close();
  await server.close();
  await app.app.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
