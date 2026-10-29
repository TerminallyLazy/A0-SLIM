import { test } from 'node:test';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  readdir,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { Updater, compareVersions, releaseMetadata, runProcess } = await import(
  new URL('../scripts/update.mjs', import.meta.url).href
);

test('an offline automatic startup launches the installed app and keeps update commands available', async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.root, 'launch.mjs'),
      await readFile(new URL('../scripts/managed-launcher.mjs', import.meta.url), 'utf8'),
    );
    await writeFile(
      join(f.root, 'update.mjs'),
      await readFile(new URL('../scripts/update.mjs', import.meta.url), 'utf8'),
    );
    const app = join(f.old, 'node_modules/a0-slim/bin');
    await mkdir(app);
    await writeFile(join(app, 'a0-slim.mjs'), 'console.log("Fixture app started");');
    const offline = join(f.root, 'offline.mjs');
    await writeFile(
      offline,
      'globalThis.fetch = async () => { throw new Error("offline fixture"); };',
    );
    const run = async (args: string[]) => {
      const child = spawn(
        process.execPath,
        ['--import', offline, join(f.root, 'launch.mjs'), ...args],
        {
          env: {
            HOME: f.root,
            PATH: process.env.PATH,
            A0_SLIM_NO_BROWSER: '1',
            A0_SLIM_DATA_DIR: join(f.root, 'data'),
          },
        },
      );
      let output = '';
      child.stdout.on('data', (b) => (output += b));
      child.stderr.on('data', (b) => (output += b));
      assert.equal(await new Promise((r) => child.once('exit', r)), 0, output);
      return output;
    };
    assert.match(await run([]), /Update skipped: offline fixture[\s\S]*Fixture app started/);
    assert.equal(await run(['--version']), '0.1.0-alpha.2\n');
    assert.match(await run(['update', '--auto=off']), /Automatic updates off/);
    assert.equal(await run([]), 'Fixture app started\n');
    await f.preserved();
  } finally {
    await f.close();
  }
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "slim-update user's-")));
  const old = join(root, 'releases/old');
  await mkdir(join(old, 'node_modules/a0-slim'), { recursive: true });
  await mkdir(join(root, 'npm-home'));
  await writeFile(
    join(old, 'node_modules/a0-slim/package.json'),
    JSON.stringify({ name: 'a0-slim', version: '0.1.0-alpha.2' }),
  );
  await writeFile(join(old, 'keep'), 'previous release');
  await writeFile(join(root, 'saved-app-data'), 'user data');
  await writeFile(
    join(root, 'runtime.json'),
    JSON.stringify({ node: process.execPath, npm: '/opt/npm/npm-cli.js' }),
  );
  await symlink(old, join(root, 'current'), 'dir');
  const archive = Buffer.from('synthetic release archive');
  const metadata = {
    name: 'a0-slim',
    version: '0.1.0-alpha.3',
    dist: {
      tarball: 'https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.3.tgz',
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    },
  };
  const calls: { command: string; args: string[]; options: any }[] = [];
  const requests: string[] = [];
  const log: string[] = [];
  const run = async (command: string, args: string[], options: any) => {
    calls.push({ command, args, options });
    if (args.includes('install')) {
      await mkdir(join(options.cwd, 'node_modules/a0-slim'), { recursive: true });
      await writeFile(
        join(options.cwd, 'node_modules/a0-slim/package.json'),
        JSON.stringify({ name: 'a0-slim', version: metadata.version }),
      );
    }
  };
  const fetchImpl = async (url: string, options: any) => {
    requests.push(url);
    assert.equal(options.redirect, 'error');
    return new Response(url.endsWith('/latest') ? JSON.stringify(metadata) : archive);
  };
  const updater = (extra: Record<string, unknown> = {}) =>
    new Updater(root, { run, fetchImpl, log: (s: string) => log.push(s), ...extra });
  const preserved = async () => {
    assert.equal(await realpath(join(root, 'current')), old);
    assert.equal(await readFile(join(root, 'saved-app-data'), 'utf8'), 'user data');
    assert.ok(
      !(await readdir(root)).some((n) => n === '.install-lock' || n.startsWith('.update-')),
    );
  };
  return {
    root,
    old,
    archive,
    metadata,
    calls,
    requests,
    log,
    run,
    fetchImpl,
    updater,
    preserved,
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test('update versions compare numerically across prereleases and reject malformed releases', () => {
  for (const [a, b] of [
    ['0.1.0-alpha.9', '0.1.0-alpha.10'],
    ['0.1.0-alpha.10', '0.1.0-beta.1'],
    ['0.1.0-beta.1', '0.1.0'],
    ['0.9.0', '0.10.0'],
    ['0.1.0-alpha', '0.1.0-alpha.1'],
  ])
    assert.equal(compareVersions(a, b), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  for (const value of ['../release', '01.2.3', '1.2.3-alpha.01', '1.2.3; touch /tmp/x'])
    assert.throws(() => compareVersions(value, '1.2.3'));
});

test('registry metadata cannot redirect executable downloads to another host or skip integrity', async () => {
  const f = await fixture();
  try {
    assert.equal(releaseMetadata(f.metadata).version, f.metadata.version);
    for (const dist of [
      { ...f.metadata.dist, tarball: 'https://evil.example/a.tgz' },
      { ...f.metadata.dist, tarball: f.metadata.dist.tarball + '?secret=1' },
      { ...f.metadata.dist, integrity: '' },
    ])
      assert.throws(() => releaseMetadata({ ...f.metadata, dist }));
    assert.throws(() => releaseMetadata({ ...f.metadata, name: 'different-package' }));
  } finally {
    await f.close();
  }
});

test('verified updates stage and probe before switching; retain prior release and user data', async () => {
  const f = await fixture();
  try {
    const updater = f.updater({
      run: async (...args: any[]) => {
        assert.equal(await realpath(join(f.root, 'current')), f.old);
        await f.run(args[0], args[1], args[2]);
      },
    });
    assert.equal((await updater.update()).installed, true);
    assert.equal(await updater.currentVersion(), '0.1.0-alpha.3');
    assert.equal(f.calls.length, 3);
    assert.ok(f.calls[0]!.args.includes('--ignore-scripts'));
    assert.ok(f.calls[0]!.args.includes('--engine-strict'));
    assert.deepEqual(Object.keys(f.calls[0]!.options.env).sort(), ['HOME', 'PATH']);
    assert.equal(await readFile(join(f.old, 'keep'), 'utf8'), 'previous release');
    assert.equal(await readFile(join(f.root, 'saved-app-data'), 'utf8'), 'user data');
    await updater.update();
    assert.equal(f.calls.length, 3, 'same version must not reinstall');
    assert.ok(!(await readdir(f.root)).includes('.install-lock'));
  } finally {
    await f.close();
  }
});

for (const failure of ['offline', 'checksum', 'npm', 'probe', 'cancel', 'oversize'] as const)
  test(`update ${failure} leaves the previous release active and removes staging/lock`, async () => {
    const f = await fixture(),
      controller = new AbortController();
    let step = 0;
    try {
      const updater = f.updater({
        fetchImpl: async (url: string, options: any) => {
          if (failure === 'offline') throw new Error('offline');
          if (!url.endsWith('/latest') && failure === 'checksum') return new Response('tampered');
          if (url.endsWith('/latest') && failure === 'oversize')
            return new Response('x'.repeat(300000));
          return f.fetchImpl(url, options);
        },
        run: async (command: string, args: string[], options: any) => {
          step++;
          if ((failure === 'npm' && step === 1) || (failure === 'probe' && step === 2))
            throw new Error(failure);
          await f.run(command, args, options);
          if (failure === 'cancel' && step === 3) controller.abort(new Error('cancelled'));
        },
      });
      await assert.rejects(updater.update({ signal: controller.signal }));
      await f.preserved();
      if (failure === 'checksum' || failure === 'oversize' || failure === 'offline')
        assert.equal(step, 0);
    } finally {
      await f.close();
    }
  });

test('automatic updates honor opt-out, daily backoff, manual retry and no downgrades', async () => {
  const f = await fixture();
  let now = 100000000;
  try {
    const updater = f.updater({
      now: () => now,
      fetchImpl: async () => {
        f.requests.push('offline');
        throw new Error('offline');
      },
    });
    await updater.preference(false);
    await updater.update({ automatic: true });
    assert.equal(f.requests.length, 0);
    await updater.preference(true);
    await assert.rejects(updater.update({ automatic: true }));
    await updater.update({ automatic: true });
    assert.equal(f.requests.length, 1);
    await assert.rejects(updater.update());
    assert.equal(f.requests.length, 2);
    now += 24 * 60 * 60 * 1000;
    await assert.rejects(updater.update({ automatic: true }));
    assert.equal(f.requests.length, 3);
    f.metadata.version = '0.1.0-alpha.1';
    f.metadata.dist.tarball = 'https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.1.tgz';
    assert.equal((await f.updater().update()).available, false);
    await f.preserved();
  } finally {
    await f.close();
  }
});

test('updater shares the installer lock and refuses an active release outside the installation', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, '.install-lock'));
    await assert.rejects(f.updater().update(), /in progress/);
    await rm(join(f.root, '.install-lock'), { recursive: true });
    await rm(join(f.root, 'current'));
    await symlink(tmpdir(), join(f.root, 'current'), 'dir');
    await assert.rejects(f.updater().update(), /outside/);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test('update cancellation waits for its actual child process to stop', async () => {
  const f = await fixture(),
    controller = new AbortController();
  const pidFile = join(f.root, 'child.pid');
  try {
    const work = runProcess(
      process.execPath,
      [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",
        pidFile,
      ],
      { env: { PATH: process.env.PATH }, signal: controller.signal },
    );
    const rejected = assert.rejects(work);
    let pid = 0;
    for (let i = 0; i < 100; i++) {
      try {
        pid = Number(await readFile(pidFile, 'utf8'));
        if (pid) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(pid);
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0));
  } finally {
    controller.abort();
    await f.close();
  }
});
