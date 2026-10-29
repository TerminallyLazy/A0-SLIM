import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

const registry = 'https://registry.npmjs.org';
const day = 24 * 60 * 60 * 1000;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = typeof v === 'string' && v.length < 100 && v.match(versionPattern);
    if (!m || m[4]?.split('.').some((part) => /^0\d+$/.test(part)))
      throw new Error('Invalid release version.');
    return [m.slice(1, 4).map(BigInt), m[4]?.split('.')];
  };
  const [x, xp] = parse(a),
    [y, yp] = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  if (!xp || !yp) return xp ? -1 : yp ? 1 : 0;
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const p = xp[i],
      q = yp[i];
    if (p === q) continue;
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p),
      qn = /^\d+$/.test(q);
    if (pn && qn) return BigInt(p) > BigInt(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    return p > q ? 1 : -1;
  }
  return 0;
}
async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
async function atomicJSON(path, value) {
  const pending = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(pending, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }
}
async function bytes(response, limit) {
  if (!response.ok || !response.body)
    throw new Error(`Release download failed (HTTP ${response.status}).`);
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('Release response exceeds the download limit.');
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function releaseMetadata(raw) {
  if (raw?.name !== 'a0-slim') throw new Error('Unexpected package in release metadata.');
  compareVersions(raw.version, raw.version);
  const tarball = `${registry}/a0-slim/-/a0-slim-${raw.version}.tgz`;
  if (
    raw.dist?.tarball !== tarball ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(raw.dist?.integrity ?? '')
  )
    throw new Error('Release metadata has an unexpected download address or checksum.');
  return { version: raw.version, tarball, integrity: raw.dist.integrity };
}
export async function runProcess(command, args, options) {
  const { signal, ...rest } = options;
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...rest,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      stopping = false,
      timer;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {}
      timer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }, 2000);
      timer.unref();
    };
    const collect = (b) => {
      output = (output + b.toString()).slice(-3000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    signal?.addEventListener('abort', stop, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(new Error(`Update verification failed (${code}). ${output.trim()}`));
    });
    if (signal?.aborted) stop();
  });
}
const probe = `
const { createRequire } = require('node:module');
const { join } = require('node:path');
const requireApp = createRequire(join(process.argv[1], 'node_modules/a0-slim/package.json'));
const p = requireApp('./package.json');
if (p.name !== 'a0-slim' || p.version !== process.argv[2]) throw new Error('Unexpected installed version');
requireApp('./scripts/patch-libfx.cjs');
requireApp('cbor-extract');
const Database = requireApp('better-sqlite3');
const db = new Database(':memory:'); db.prepare('select 1').get(); db.close();
requireApp('libfx').getBackendInfo({surface:'agent',backend:'native'}).then(info => {
  if (info.backend !== 'native') throw new Error('Native agent runtime unavailable');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
`;
export class Updater {
  constructor(
    root,
    { fetchImpl = fetch, run = runProcess, log = console.log, now = Date.now } = {},
  ) {
    this.root = root;
    this.fetch = fetchImpl;
    this.run = run;
    this.log = log;
    this.now = now;
  }
  async validateRoot() {
    if (!isAbsolute(this.root)) throw new Error('The managed installation path must be absolute.');
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid())
      throw new Error('The managed installation must be an owned directory.');
    this.root = await realpath(this.root);
    const current = await realpath(join(this.root, 'current'));
    const rel = relative(join(this.root, 'releases'), current);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('The active release is outside this managed installation.');
    return current;
  }
  async currentVersion() {
    const current = await this.validateRoot();
    const pkg = await json(join(current, 'node_modules/a0-slim/package.json'));
    if (pkg.name !== 'a0-slim') throw new Error('Unexpected installed package.');
    compareVersions(pkg.version, pkg.version);
    return pkg.version;
  }
  async state() {
    try {
      return await json(join(this.root, 'updates.json'));
    } catch (e) {
      if (e.code === 'ENOENT') return { automatic: true };
      throw e;
    }
  }
  async locked(task) {
    await this.validateRoot();
    const lock = join(this.root, '.install-lock');
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch (e) {
      if (e.code === 'EEXIST')
        throw new Error(
          'Another installation or update is in progress. Try again when it finishes.',
        );
      throw e;
    }
    try {
      return await task();
    } finally {
      await rmdir(lock);
    }
  }
  async preference(automatic) {
    await this.locked(async () =>
      atomicJSON(join(this.root, 'updates.json'), { ...(await this.state()), automatic }),
    );
    this.log(`Automatic updates ${automatic ? 'on' : 'off'}.`);
  }
  async check(signal) {
    const current = await this.currentVersion();
    const response = await this.fetch(`${registry}/a0-slim/latest`, {
      redirect: 'error',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(5000)]),
      headers: { accept: 'application/json' },
    });
    const release = releaseMetadata(
      JSON.parse((await bytes(response, 256 * 1024)).toString('utf8')),
    );
    return { current, release, available: compareVersions(release.version, current) > 0 };
  }
  async update({ automatic = false, signal } = {}) {
    return this.locked(async () => {
      const state = await this.state();
      if (
        automatic &&
        (state.automatic === false ||
          (state.lastCheck <= this.now() && this.now() - state.lastCheck < day))
      )
        return;
      // Throttle failed background checks too; a manual update always retries immediately.
      if (automatic)
        await atomicJSON(join(this.root, 'updates.json'), { ...state, lastCheck: this.now() });
      const result = await this.check(signal);
      if (!result.available) {
        await atomicJSON(join(this.root, 'updates.json'), { ...state, lastCheck: this.now() });
        if (!automatic) this.log(`A0 SLIM ${result.current} is up to date.`);
        return result;
      }
      const { release } = result;
      this.log(`Updating A0 SLIM ${result.current} → ${release.version}…`);
      const workSignal = AbortSignal.any([
        signal ?? new AbortController().signal,
        AbortSignal.timeout(10 * 60_000),
      ]);
      const stage = await mkdtemp(join(this.root, '.update-'));
      let pending;
      try {
        const response = await this.fetch(release.tarball, {
          redirect: 'error',
          signal: workSignal,
        });
        const archive = await bytes(response, 16 * 1024 * 1024);
        if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== release.integrity)
          throw new Error('Release checksum mismatch. The previous version is unchanged.');
        const tarball = join(stage, 'a0-slim.tgz'),
          app = join(stage, 'app');
        await writeFile(tarball, archive, { flag: 'wx', mode: 0o600 });
        await mkdir(app);
        await writeFile(join(app, 'package.json'), '{"private":true}\n');
        await writeFile(join(stage, 'npmrc'), '');
        await writeFile(join(stage, 'global-npmrc'), '');
        const runtime = await json(join(this.root, 'runtime.json'));
        if (!isAbsolute(runtime.node ?? '') || !isAbsolute(runtime.npm ?? ''))
          throw new Error('Managed runtime metadata is missing. Re-run the installer.');
        const env = {
          HOME: join(this.root, 'npm-home'),
          PATH: `${join(runtime.node, '..')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        };
        await this.run(
          runtime.node,
          [
            runtime.npm,
            '--userconfig',
            join(stage, 'npmrc'),
            '--globalconfig',
            join(stage, 'global-npmrc'),
            '--registry=https://registry.npmjs.org/',
            'install',
            tarball,
            '--omit=dev',
            '--ignore-scripts',
            '--engine-strict',
            '--no-audit',
            '--no-fund',
          ],
          { cwd: app, env, signal: workSignal },
        );
        await this.run(runtime.node, ['-e', probe, app, release.version], {
          cwd: app,
          env,
          signal: AbortSignal.any([workSignal, AbortSignal.timeout(30000)]),
        });
        await this.run(
          runtime.node,
          [join(app, 'node_modules/a0-slim/bin/a0-slim.mjs'), '--help'],
          { cwd: app, env, signal: AbortSignal.any([workSignal, AbortSignal.timeout(15000)]) },
        );
        await writeFile(
          join(app, '.verified-tarball'),
          createHash('sha256').update(archive).digest('hex') + '\n',
        );
        const destination = join(this.root, 'releases', `${release.version}-${randomUUID()}`);
        await rename(app, destination);
        pending = join(this.root, `.current-${randomUUID()}`);
        await symlink(destination, pending, 'dir');
        workSignal.throwIfAborted();
        if (!(await lstat(join(this.root, 'current'))).isSymbolicLink())
          throw new Error('Refusing to replace a non-symlink current path.');
        await rename(pending, join(this.root, 'current'));
        await atomicJSON(join(this.root, 'updates.json'), {
          ...state,
          lastCheck: this.now(),
          installed: release.version,
        }).catch(() => this.log('The update is installed; its status could not be saved.'));
        this.log(
          `A0 SLIM ${release.version} is installed. ${automatic ? 'Starting the updated version.' : 'Running sessions keep working; your next launch uses the update.'}`,
        );
        return { ...result, installed: true };
      } finally {
        if (pending) await rm(pending, { force: true });
        await rm(stage, { recursive: true, force: true });
      }
    });
  }
}
export async function updateCommand(root, args = []) {
  if (!root) {
    throw new Error(
      'This installation is managed by npm or a source checkout. For npm: npm install -g a0-slim@latest --ignore-scripts. For automatic updates, use the curl installer described in README.',
    );
  }
  const updater = new Updater(root);
  if (args.length === 1 && ['--auto=on', '--auto=off'].includes(args[0]))
    return updater.preference(args[0] === '--auto=on');
  if (args.length === 1 && args[0] === '--check') {
    const result = await updater.check();
    console.log(
      result.available
        ? `A0 SLIM ${result.release.version} is available. Run a0-slim update to install it.`
        : `A0 SLIM ${result.current} is up to date.`,
    );
    return result;
  }
  if (args.length) throw new Error('Usage: a0-slim update [--check | --auto=on | --auto=off]');
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Update cancelled.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('SIGHUP', interrupt);
  try {
    return await updater.update({ signal: controller.signal });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGHUP', interrupt);
  }
}
