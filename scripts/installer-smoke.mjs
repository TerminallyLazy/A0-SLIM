import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const supplied = process.argv.indexOf('--installer');
const installer = await readFile(
  supplied < 0 ? new URL('../install.sh', import.meta.url) : resolve(process.argv[supplied + 1]),
  'utf8',
);
const temp = await mkdtemp(join(tmpdir(), 'slim-installer-'));
const children = new Set();
try {
  const thin = join(temp, 'tools');
  await mkdir(thin);
  for (const name of [
    'id',
    'uname',
    'curl',
    'tar',
    'gzip',
    'mktemp',
    'cut',
    'shasum',
    'sha256sum',
    'dirname',
    'mkdir',
    'mv',
    'rmdir',
    'rm',
    'cat',
    'basename',
    'env',
    'sh',
    'chmod',
  ]) {
    let binary;
    try {
      binary = execFileSync('/bin/sh', ['-c', 'command -v "$1"', '--', name], {
        encoding: 'utf8',
      }).trim();
    } catch {
      continue;
    }
    if (binary.startsWith('/')) await symlink(binary, join(thin, name));
  }
  const refusedCurl = join(temp, 'no-network');
  await mkdir(refusedCurl);
  await writeFile(
    join(refusedCurl, 'curl'),
    '#!/bin/sh\necho "Unexpected second download" >&2\nexit 77\n',
    { mode: 0o700 },
  );

  async function run(mode, env, noLaunch = false) {
    const child = spawn('/bin/sh', ['-s', '--', ...(noLaunch ? ['--no-launch'] : [])], {
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.add(child);
    let out = '',
      err = '';
    child.stdout.on('data', (b) => {
      out += b;
    });
    child.stderr.on('data', (b) => {
      err += b;
    });
    const ended = new Promise((done, fail) => {
      child.once('error', fail);
      child.once('exit', (code) => {
        children.delete(child);
        done(code);
      });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(installer);
    const until = Date.now() + 300_000;
    while (
      !out.includes('Pair this browser within 10 minutes:') &&
      child.exitCode === null &&
      Date.now() < until
    )
      await new Promise((r) => setTimeout(r, 100));
    if (noLaunch) {
      assert.equal(await ended, 0, err.slice(-2000));
      assert.match(out, /Checking the existing A0 SLIM installation/);
      return;
    }
    const code = out.match(/Pair this browser within 10 minutes: (\S+)/)?.[1];
    assert.ok(code, `Installer ${mode} failed: ${err.slice(-12000)}`);
    assert.match(
      out,
      mode === 'bootstrap' ? /Setting up private Node 24.22.1/ : /Using your existing Node 24/,
    );
    const origin = `http://127.0.0.1:${env.A0_SLIM_PORT}`;
    assert.equal((await fetch(origin)).status, 200);
    const paired = await fetch(`${origin}/api/v1/pair`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    assert.equal(paired.status, 200);
    const cookie = paired.headers.get('set-cookie').split(';')[0];
    const embeddings = await fetch(`${origin}/api/v1/embeddings`, { headers: { cookie } });
    assert.equal((await embeddings.json()).local.runtime.status, 'not-installed');
    const command = execFileSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-c', '. "$HOME/.bashrc"; command -v a0-slim; a0-slim --help'],
      { env, encoding: 'utf8' },
    );
    assert.ok(command.startsWith(join(env.HOME, '.local/bin/a0-slim') + '\n'));
    assert.match(command, /Usage: a0-slim/);
    assert.equal(
      (await readFile(join(env.HOME, '.bashrc'), 'utf8')).split('# >>> A0 SLIM PATH >>>').length,
      2,
    );
    // A repeat launch with default data selection recognizes an existing service without replacing it.
    const reuseEnv = { ...env };
    delete reuseEnv.A0_SLIM_DATA_DIR;
    const reuse = spawn(
      '/bin/bash',
      ['--noprofile', '--norc', '-c', '. "$HOME/.bashrc"; exec a0-slim'],
      {
        env: reuseEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let reused = '';
    reuse.stdout.on('data', (b) => {
      reused += b;
    });
    assert.equal(await new Promise((r) => reuse.once('exit', r)), 0);
    assert.match(reused, /already running/);
    child.kill('SIGTERM');
    assert.equal(await ended, 0, 'Launcher did not shut down cleanly');
    await assert.rejects(fetch(origin));
    assert.ok(!(await readdir(env.A0_SLIM_INSTALL_DIR)).includes('.install-lock'));
    console.log(
      `${mode}: installer registered a0-slim, launched, paired, served UI; existing-service reuse and clean stop passed`,
    );
  }

  for (const mode of process.argv.includes('--bootstrap-only')
    ? ['bootstrap']
    : ['existing', 'bootstrap']) {
    const home = join(temp, mode);
    await mkdir(home);
    await writeFile(join(home, '.npmrc'), 'registry=https://invalid.example/\n');
    const server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    await new Promise((r) => server.close(r));
    const env = {
      HOME: home,
      SHELL: '/bin/bash',
      PATH: mode === 'bootstrap' ? thin : process.env.PATH,
      A0_SLIM_INSTALL_DIR: join(home, "app's install directory"),
      A0_SLIM_DATA_DIR: join(home, 'data'),
      A0_SLIM_PORT: String(port),
      A0_SLIM_NO_BROWSER: '1',
    };
    await run(mode, env);
    await run(mode, { ...env, PATH: `${refusedCurl}:${env.PATH}` }, true);
    console.log(`${mode}: repeat installation passed with downloads disabled`);
  }
  console.log('Installer checks passed; no model accounts or cloud sandboxes were used.');
} finally {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  await rm(temp, { recursive: true, force: true });
}
