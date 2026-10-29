/** Isolated browser harness. All OpenShell responses are fixtures; no provider resources or secrets. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../src/server/app.js';
process.umask(0o077);
const dir = await mkdtemp(join(tmpdir(), 'slim-openshell-ui-'));
let sandbox: any = null;
const instance = await createApp({
  dataDir: dir,
  origin: 'http://127.0.0.1:4312',
  pairingCode: 'openshell-fixture-only',
  staticDir: resolve('dist/ui'),
  keySource: async () => Buffer.alloc(32, 8),
  openshell: {
    installed: async () => true,
    runner: async (_dir, request) => {
      switch (request.action) {
        case 'inspect':
          return {
            health: 'healthy',
            authentication: 'verified',
            access: 'verified',
            version: '0.1.6',
            principal: 'a'.repeat(64),
          };
        case 'create':
          sandbox = {
            id: 'synthetic-sandbox-id',
            name: request.name,
            workspace: request.config.workspace,
            phase: 'ready',
            labels: request.labels,
          };
          return { sandbox };
        case 'get':
        case 'ready':
          return { sandbox };
        case 'execute':
          return { outputVerified: true };
        case 'delete':
          sandbox = null;
          return { deletion: { outcome: 'accepted', sandboxId: request.sandboxId } };
        case 'wait-deleted':
          return { absent: true };
      }
    },
  },
});
instance.store.setMeta('first-run', JSON.stringify({ completedAt: new Date().toISOString() }));
await instance.openshell.save({
  gateway: 'https://gateway.example',
  workspace: 'slim-checks',
  image: 'fixture/shell:1',
  auth: 'oidc',
  token: 'synthetic-fixture-token',
});
await instance.app.listen({ host: '127.0.0.1', port: 4312 });
console.log('OpenShell UI fixture: http://127.0.0.1:4312 · pairing code openshell-fixture-only');
const stop = async () => {
  await instance.app.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
