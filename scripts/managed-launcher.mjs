import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
const args = process.argv.slice(2);
const url = `http://127.0.0.1:${process.env.A0_SLIM_PORT ?? '4310'}`;
const packageRoot = join(root, 'current/node_modules/a0-slim');
const version = async () =>
  JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
function openBrowser() {
  if (process.env.A0_SLIM_NO_BROWSER === '1' || args.includes('--no-open')) return;
  const browser = spawn(process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open', [url], {
    stdio: 'ignore',
    detached: true,
  });
  browser.on('error', () => {});
  browser.unref();
}
async function updaterModule() {
  // Once the package supplies its own updater, fixes to the updater ship with normal releases.
  const packaged = join(packageRoot, 'scripts/update.mjs');
  try {
    await readFile(packaged);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return import(pathToFileURL(join(root, 'update.mjs')).href);
  }
  return import(pathToFileURL(packaged).href);
}
async function main() {
  if (args.includes('--help')) {
    console.log(
      'A0 SLIM\n\nUsage: a0-slim [--no-open]\n       a0-slim update [--check | --auto=on | --auto=off]\n       a0-slim --version\n\nAutomatic updates are on by default and checked at most once a day before startup.\nUpdates preserve your app data and never interrupt a running session.\nEnvironment: A0_SLIM_PORT, A0_SLIM_DATA_DIR, A0_SLIM_NO_UPDATE=1',
    );
    return;
  }
  if (args[0] === '--version') {
    console.log(await version());
    return;
  }
  if (args[0] === 'update') {
    await (await updaterModule()).updateCommand(root, args.slice(1));
    return;
  }
  // Reopening a service never performs an update or interrupts an active turn.
  if (!process.env.A0_SLIM_DATA_DIR) {
    try {
      const response = await fetch(`${url}/api/v1/status`, { signal: AbortSignal.timeout(700) });
      const status = await response.json();
      if (
        response.ok &&
        typeof status.version === 'string' &&
        status.stage === 'P2 preview · account checks pending' &&
        typeof status.paired === 'boolean'
      ) {
        const installed = await version();
        console.log(
          status.version === installed
            ? `A0 SLIM is already running at ${url}. Its original terminal holds the pairing code.`
            : `A0 SLIM ${status.version} is still running at ${url}. Version ${installed} is installed for your next start. Stop it in its original terminal when you are ready to restart.`,
        );
        openBrowser();
        return;
      }
    } catch {
      /* Start normally when no recognizable server is listening. */
    }
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Startup cancelled.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('SIGHUP', interrupt);
  try {
    if (process.env.A0_SLIM_NO_UPDATE !== '1') {
      try {
        await new (await updaterModule()).Updater(root).update({
          automatic: true,
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) throw e;
        console.error(
          `Update skipped: ${e.message}\nStarting the installed version. Retry with a0-slim update.`,
        );
      }
    }
    controller.signal.throwIfAborted();
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGHUP', interrupt);
  }
  const child = spawn(process.execPath, [join(packageRoot, 'bin/a0-slim.mjs'), ...args], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env, A0_SLIM_NO_BROWSER: '1', A0_SLIM_MANAGED_ROOT: root },
  });
  let ready = '',
    opened = false;
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    if (opened) return;
    ready = (ready + chunk.toString()).slice(-4096);
    if (!ready.includes('Pair this browser within 10 minutes:')) return;
    opened = true;
    openBrowser();
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, () => child.kill(signal));
  child.on('error', (e) => {
    console.error(`A0 SLIM could not start: ${e.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
  });
}
main().catch((e) => {
  console.error(`A0 SLIM: ${e.message}`);
  process.exitCode = 1;
});
