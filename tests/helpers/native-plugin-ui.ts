// Manual browser proof using only a retained native-plugin-live-check fixture.
import { realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createApp } from '../../src/server/app.js';
import { startModelFixture } from './model-server.js';
const directory = await realpath(process.argv[2] ?? '');
if (!/^slim-native-plugin-[A-Za-z0-9]+$/.test(basename(directory)))
  throw new Error('Choose an explicitly retained native plugin proof directory.');
const { app, store, runtime } = await createApp({
  dataDir: join(directory, 'data'),
  origin: 'http://127.0.0.1:4313',
  pairingCode: 'native-plugin-fixture',
  keySource: async () => Buffer.alloc(32, 7),
  staticDir: resolve('dist/ui'),
});
const project = store.projects()[0]!;
const binding = (await runtime.extensions.plugins.projectState(project.id)).binding!;
const model = await startModelFixture({
  tool: 'mcp_call',
  toolInput: { serverId: binding.serverId, tool: 'db_hub_schema', arguments: {} },
});
for (const connection of store.connections())
  store.saveConnection({ ...connection, baseUrl: model.url });
await runtime.extensions.hub.refresh();
await runtime.extensions.hub.assess('db_hub');
await app.listen({ host: '127.0.0.1', port: 4313 });
console.log('Synthetic native plugin UI: http://127.0.0.1:4313 · pairing: native-plugin-fixture');
const stop = async () => {
  await app.close();
  await model.close();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
