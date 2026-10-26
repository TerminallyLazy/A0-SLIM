import { createApp } from '../../src/server/app.js';
const [dataDir, chatId, messageId] = process.argv.slice(2) as [string, string, string];
const app = await createApp({
  dataDir,
  origin: 'http://127.0.0.1:4317',
  pairingCode: 'test',
  keySource: async () => Buffer.alloc(32, 4),
});
await app.runtime.prompt(chatId, 'Review the project.', messageId);
setInterval(() => {}, 1000);
process.send?.({ ready: true });
