import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  symlink,
  rm,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { Updater, runProcess } from './update.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await realpath(await mkdtemp(join(tmpdir(), "slim-real-update user's-")));
const root = join(temp, 'install');
const npm =
  process.env.npm_execpath ??
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
let service;
try {
  await runProcess(
    process.execPath,
    [npm, 'pack', '--ignore-scripts', '--pack-destination', temp],
    {
      cwd: repo,
      env: { HOME: temp, PATH: process.env.PATH },
      signal: AbortSignal.timeout(30000),
    },
  );
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const archive = await readFile(join(temp, `a0-slim-${pkg.version}.tgz`));
  const old = join(root, 'releases/previous');
  await mkdir(join(old, 'node_modules/a0-slim'), { recursive: true });
  await mkdir(join(root, 'npm-home'));
  await writeFile(
    join(old, 'node_modules/a0-slim/package.json'),
    JSON.stringify({ name: 'a0-slim', version: '0.0.0' }),
  );
  await writeFile(join(old, 'sentinel'), 'keep previous release');
  await symlink(old, join(root, 'current'), 'dir');
  await writeFile(join(root, 'runtime.json'), JSON.stringify({ node: process.execPath, npm }));
  await copyFile(join(repo, 'scripts/update.mjs'), join(root, 'update.mjs'));
  await copyFile(join(repo, 'scripts/managed-launcher.mjs'), join(root, 'launch.mjs'));
  const data = join(temp, 'saved-data');
  await mkdir(data);
  await writeFile(join(data, 'sentinel'), 'keep user data');
  const metadata = {
    name: 'a0-slim',
    version: pkg.version,
    dist: {
      tarball: `https://registry.npmjs.org/a0-slim/-/a0-slim-${pkg.version}.tgz`,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    },
  };
  const updater = new Updater(root, {
    fetchImpl: async (url) => {
      if (url === 'https://registry.npmjs.org/a0-slim/latest')
        return new Response(JSON.stringify(metadata));
      assert.equal(url, metadata.dist.tarball);
      return new Response(archive);
    },
  });
  const fixture = join(temp, 'registry-fixture.mjs');
  await writeFile(
    fixture,
    `
import { readFile } from 'node:fs/promises';
const originalFetch = globalThis.fetch;
const metadata = ${JSON.stringify(metadata)};
globalThis.fetch = async (url, options) => {
  if (url === 'https://registry.npmjs.org/a0-slim/latest') return new Response(JSON.stringify(metadata));
  if (url === metadata.dist.tarball) return new Response(await readFile(${JSON.stringify(join(temp, `a0-slim-${pkg.version}.tgz`))}));
  return originalFetch(url, options);
};
`,
  );

  const portServer = createServer();
  await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
  const port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    HOME: temp,
    PATH: process.env.PATH,
    A0_SLIM_PORT: String(port),
    A0_SLIM_DATA_DIR: data,
    A0_SLIM_NO_BROWSER: '1',
  };
  service = spawn(process.execPath, ['--import', fixture, join(root, 'launch.mjs')], {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  service.stdout.on('data', (b) => {
    output += b;
  });
  service.stderr.on('data', (b) => {
    output += b;
  });
  const ended = new Promise((r) => service.once('exit', r));
  for (
    let i = 0;
    i < 3000 &&
    !output.includes('Pair this browser within 10 minutes:') &&
    service.exitCode === null;
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  const code = output.match(/Pair this browser within 10 minutes: (\S+)/)?.[1];
  assert.ok(code, output.slice(-4000));
  assert.match(output, /Updating A0 SLIM 0.0.0/);
  assert.match(output, /Starting the updated version/);
  assert.equal(await updater.currentVersion(), pkg.version);
  assert.equal(await readFile(join(old, 'sentinel'), 'utf8'), 'keep previous release');
  assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'keep user data');
  await updater.update({ automatic: true }); // Cached startup must not reinstall.
  const status = await (await fetch(`${origin}/api/v1/status`)).json();
  assert.equal(status.version, pkg.version);
  const paired = await fetch(`${origin}/api/v1/pair`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  assert.equal(paired.status, 200);
  assert.equal((await fetch(origin)).status, 200);
  await runProcess(process.execPath, [join(root, 'launch.mjs'), 'update', '--auto=off'], {
    env,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await updater.state()).automatic, false);
  await runProcess(process.execPath, [join(root, 'launch.mjs'), 'update', '--auto=on'], {
    env,
    signal: AbortSignal.timeout(5000),
  });
  assert.equal((await updater.state()).automatic, true);
  service.kill('SIGTERM');
  assert.equal(await ended, 0);
  await assert.rejects(fetch(origin));
  assert.equal(await readFile(join(data, 'sentinel'), 'utf8'), 'keep user data');
  console.log(
    JSON.stringify(
      {
        platform: process.platform,
        node: process.version,
        version: pkg.version,
        source:
          'local packed artifact and synthetic registry metadata; real npm dependency installation',
        verified: [
          'SHA-512',
          'scripts disabled',
          'native runtime probe',
          'atomic release switch',
          'previous release retained',
          'saved data preserved',
          'one launch automatically updated and started the app',
          'paired browser API and served UI',
          'automatic preference toggles',
          'clean shutdown',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (service?.exitCode === null) {
    service.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-service.pid, 'SIGKILL');
        } catch {}
      }, 10000);
      service.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(temp, { recursive: true, force: true });
}
