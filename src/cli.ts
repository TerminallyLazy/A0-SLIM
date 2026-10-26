import { randomBytes } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createApp } from './server/app.js';
import { acquireServiceLock } from './storage/lock.js';

if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('A0 SLIM requires Node 24. Use the version in .node-version.');
process.umask(0o077);
const base =
  platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'));
const dataDir = resolve(process.env.A0_SLIM_DATA_DIR ?? join(base, 'A0-SLIM'));
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const code = randomBytes(12).toString('base64url');
const port = Number(process.env.A0_SLIM_PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose A0_SLIM_PORT between 1024 and 65535.');
const releaseLock = acquireServiceLock(dataDir);
const origin = `http://127.0.0.1:${port}`;
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = here.endsWith(`${platform() === 'win32' ? '\\' : '/'}src`)
  ? resolve(here, '../dist/ui')
  : resolve(here, '../ui');
try {
  const { app } = await createApp({ dataDir, origin, pairingCode: code, staticDir });
  await app.listen({ host: '127.0.0.1', port });
  console.log(
    `\nA0 SLIM · Local alpha\n${origin}\nPair this browser within 10 minutes: ${code}\n\nPress Ctrl+C to stop the local service.\n`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    releaseLock();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  releaseLock();
  throw error;
}
