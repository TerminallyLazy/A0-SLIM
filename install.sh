#!/bin/sh
# A0 SLIM installer. Keep execution inside main so a truncated download cannot run a partial install.
set -eu

slim_fail() { printf 'A0 SLIM: %s\n' "$*" >&2; exit 1; }
slim_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else shasum -a 256 "$1" | cut -d ' ' -f 1; fi
}
slim_download() {
  curl -q --fail --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 600 --output "$2" "$1"
  [ "$(slim_sha256 "$2")" = "$3" ] || slim_fail "Checksum mismatch for $1. Nothing from this download was executed."
}
slim_clean() {
  [ -z "${slim_stage:-}" ] || rm -rf "$slim_stage"
  [ -z "${slim_lock:-}" ] || rmdir "$slim_lock"
}
slim_npm() {
  env -i HOME="$slim_root/npm-home" PATH="$slim_node_dir:$PATH" \
    "$slim_npm_path" --userconfig "$slim_stage/empty.npmrc" --globalconfig "$slim_stage/empty-global.npmrc" \
    --registry=https://registry.npmjs.org/ "$@"
}
slim_probe() {
  # Resolve native dependencies from the installed package, including when npm hoists them.
  env -i HOME="$slim_root/npm-home" PATH="$slim_node_dir:$PATH" "$slim_node" --input-type=module - "$1" "${2:-0.1.0-alpha.5}" <<'JS'
import { createRequire } from 'node:module';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = join(process.argv[2], 'node_modules/a0-slim');
const require = createRequire(join(base, 'package.json'));
if (require('./package.json').version !== process.argv[3]) throw new Error('Unexpected app version');
require('./scripts/patch-libfx.cjs');
require('cbor-extract'); // Load the pinned platform prebuild without running its install script.
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.prepare('select 1').get();
db.close();
const probe = join(base, `.slim-probe-${process.pid}.mjs`);
writeFileSync(probe, "export { getBackendInfo } from 'libfx';", { flag: 'wx', mode: 0o600 });
try {
  const fx = await import(pathToFileURL(probe).href);
  if ((await fx.getBackendInfo({ surface: 'agent', backend: 'native' })).backend !== 'native')
    throw new Error('Native agent runtime unavailable');
} finally { unlinkSync(probe); }
JS
}

main() {
  slim_launch=yes
  case "${1:-}" in
    '') ;;
    --no-launch) slim_launch=no; shift ;;
    --help) printf 'Usage: sh install.sh [--no-launch]\nInstalls and launches A0 SLIM. No sudo required.\nOptional: A0_SLIM_INSTALL_DIR, A0_SLIM_NO_BROWSER=1, A0_SLIM_PORT, A0_SLIM_DATA_DIR.\n'; return ;;
    *) slim_fail "Unknown option: $1" ;;
  esac
  [ "$#" -eq 0 ] || slim_fail 'Unexpected arguments.'
  [ "$(id -u)" != 0 ] || slim_fail 'Run this installer as your regular user, without sudo.'
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) slim_platform=darwin-arm64; slim_node_hash=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7 ;;
    Linux-x86_64) slim_platform=linux-x64; slim_node_hash=eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c ;;
    *) slim_fail 'This release supports Apple Silicon macOS and Linux x64 (glibc). Windows, Intel macOS and other architectures are not yet supported.' ;;
  esac
  for slim_tool in curl tar mktemp cut; do command -v "$slim_tool" >/dev/null 2>&1 || slim_fail "Install $slim_tool, then run this command again."; done
  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    slim_fail 'Install sha256sum or shasum, then run this command again.'
  fi
  : "${HOME:?HOME must be set}"
  slim_root=${A0_SLIM_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/a0-slim-cli}
  case "$slim_root" in /*) ;; *) slim_fail 'A0_SLIM_INSTALL_DIR must be an absolute path.' ;; esac
  [ ! -L "$slim_root" ] || slim_fail 'The installation directory must not be a symlink.'
  umask 077
  mkdir -p "$slim_root"
  slim_root=$(cd "$slim_root" && pwd -P)
  if ! mkdir "$slim_root/.install-lock" 2>/dev/null; then
    slim_fail "Another installer is running or was interrupted. After confirming it has stopped, remove the empty directory $slim_root/.install-lock and retry."
  fi
  slim_lock=$slim_root/.install-lock
  slim_stage=
  trap slim_clean EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  slim_stage=$(mktemp -d "$slim_root/.install.XXXXXX")
  : > "$slim_stage/empty.npmrc"
  : > "$slim_stage/empty-global.npmrc"
  mkdir -p "$slim_root/npm-home" "$slim_root/releases" "$slim_root/bin"
  # Ignore user npm configuration when checking the existing tools, as during installation.
  slim_node=$(command -v node || true)
  slim_npm_path=$(command -v npm || true)
  slim_existing=no
  if [ -n "$slim_node" ] && [ -n "$slim_npm_path" ]; then
    if env -i HOME="$slim_root/npm-home" PATH="$PATH" "$slim_node" -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)' 2>/dev/null; then
      slim_npm_version=$(env -i HOME="$slim_root/npm-home" PATH="$PATH" "$slim_npm_path" --userconfig "$slim_stage/empty.npmrc" --globalconfig "$slim_stage/empty-global.npmrc" --version 2>/dev/null || true)
      case "$slim_npm_version" in
        11.*) slim_minor=$(printf '%s' "$slim_npm_version" | cut -d . -f 2)
          case "$slim_minor" in ''|*[!0-9]*) ;; *) [ "$slim_minor" -lt 19 ] || slim_existing=yes ;; esac ;;
      esac
    fi
  fi
  if [ "$slim_existing" = yes ]; then
    slim_npm_path=$("$slim_node" -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$slim_npm_path")
    slim_node=$("$slim_node" -p process.execPath)
    printf 'Using your existing Node 24 and npm %s.\n' "$slim_npm_version"
  else
    slim_node_home=$slim_root/node-v24.22.1-$slim_platform
    if [ ! -x "$slim_node_home/bin/node" ]; then
      printf 'Setting up private Node 24.22.1 for %s…\n' "$slim_platform"
      slim_download "https://nodejs.org/dist/v24.22.1/node-v24.22.1-$slim_platform.tar.gz" "$slim_stage/node.tar.gz" "$slim_node_hash"
      tar -xzf "$slim_stage/node.tar.gz" -C "$slim_stage"
      [ ! -e "$slim_node_home" ] || slim_fail "Incomplete Node directory at $slim_node_home. Inspect/remove it and retry."
      mv "$slim_stage/node-v24.22.1-$slim_platform" "$slim_node_home"
    fi
    slim_node=$slim_node_home/bin/node
    slim_npm_path=$slim_node_home/bin/npm
  fi
  slim_node_dir=$(dirname "$slim_node")
  env -i HOME="$slim_root/npm-home" PATH="$slim_node_dir:$PATH" "$slim_node" -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)' || slim_fail 'Node 24 could not start. Linux requires a compatible glibc distribution.'
  # Generated from scripts/update.mjs by npm run sync:installer.
  cat > "$slim_stage/update.mjs" <<'UPDATER'
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
UPDATER
  mv "$slim_stage/update.mjs" "$slim_root/update.mjs"
  "$slim_node" --input-type=module - "$slim_root" "$slim_npm_path" <<'RUNTIME'
import { writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
const [root, npm] = process.argv.slice(2);
writeFileSync(join(root, 'runtime.json.tmp'), JSON.stringify({node: process.execPath, npm: realpathSync(npm)}) + '\n', {mode: 0o600});
renameSync(join(root, 'runtime.json.tmp'), join(root, 'runtime.json'));
RUNTIME
  slim_current_version=$("$slim_node" --input-type=module - "$slim_root" <<'CURRENT'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { compareVersions } = await import(pathToFileURL(join(root, 'update.mjs')).href);
try {
  const pkg = JSON.parse(readFileSync(join(root, 'current/node_modules/a0-slim/package.json'), 'utf8'));
  if (pkg.name === 'a0-slim' && compareVersions(pkg.version, '0.1.0-alpha.5') >= 0) console.log(pkg.version);
} catch { /* No healthy installed release yet. */ }
CURRENT
)
  slim_hash=a51d93860827ae6a582798633e91cca532b1cf4a28ca8de2d8bf81fbeb4dfe62
  if [ -n "$slim_current_version" ] && [ -s "$slim_root/current/.verified-tarball" ]; then
    printf 'Checking the existing A0 SLIM installation…\n'
    slim_probe "$slim_root/current" "$slim_current_version" || slim_fail 'The existing installation needs repair. Your app data has not been changed.'
  else
    printf 'Downloading and installing A0 SLIM 0.1.0-alpha.5…\n'
    slim_download 'https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.5.tgz' "$slim_stage/a0-slim.tgz" "$slim_hash"
    mkdir "$slim_stage/app"
    cat > "$slim_stage/app/package.json" <<'JSON'
{"private":true}
JSON
    (cd "$slim_stage/app" && slim_npm install "$slim_stage/a0-slim.tgz" --omit=dev --ignore-scripts --no-audit --no-fund) || slim_fail 'Installation failed. Re-run this command to retry; the previous installation and app data are preserved.'
    slim_probe "$slim_stage/app" || slim_fail 'The installed native runtime failed verification; it was not activated.'
    printf '%s\n' "$slim_hash" > "$slim_stage/app/.verified-tarball"
    slim_release=$slim_root/releases/0.1.0-alpha.5-$(basename "$slim_stage")
    mv "$slim_stage/app" "$slim_release"
    "$slim_node" --input-type=module - "$slim_root" "$slim_release" <<'JS'
import { symlinkSync, renameSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
const [root, release] = process.argv.slice(2);
const current = join(root, 'current');
try { if (!lstatSync(current).isSymbolicLink()) throw new Error('Refusing to replace a non-symlink current path'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const pending = join(root, `.current-${process.pid}`);
symlinkSync(release, pending, 'dir');
renameSync(pending, current);
JS
  fi
  # Generated from scripts/managed-launcher.mjs by npm run sync:installer.
  cat > "$slim_stage/launch.mjs" <<'LAUNCHER'
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
LAUNCHER
  mv "$slim_stage/launch.mjs" "$slim_root/launch.mjs"
  "$slim_node" --input-type=module - "$slim_root" "$slim_node" <<'JS'
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
const [root, node] = process.argv.slice(2);
const quote = (s) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const launcher = join(root, 'bin/a0-slim');
writeFileSync(`${launcher}.tmp`, `#!/bin/sh\nexec ${quote(node)} ${quote(join(root, 'launch.mjs'))} "$@"\n`, { mode: 0o700 });
renameSync(`${launcher}.tmp`, launcher);
console.log(`\nInstalled. To start again: ${quote(launcher)}\n`);
JS
  # Register the verified launcher without replacing another installation's command.
  "$slim_node" --input-type=module - "$slim_root" <<'REGISTER'
import { appendFileSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
const root = process.argv[2];
const home = process.env.HOME;
if (!home || !isAbsolute(home)) throw new Error('HOME must be an absolute path.');
const bin = join(home, '.local/bin');
const command = join(bin, 'a0-slim');
const launcher = join(root, 'bin/a0-slim');
const quote = (s) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
const manual = () => console.log(`Start directly: ${quote(launcher)}`);
function register() {
  mkdirSync(bin, { recursive: true, mode: 0o755 });
  let existing;
  try { existing = lstatSync(command); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isSymbolicLink() || resolve(bin, readlinkSync(command)) !== launcher)) {
    console.log(`Kept existing command at ${command}; it belongs to another installation.`);
    manual();
    return;
  }
  if (!existing) symlinkSync(launcher, command);
  console.log(`Command installed: ${command}`);
  if ((process.env.PATH ?? '').split(':').includes(bin)) {
    console.log('To start again, run: a0-slim');
    return;
  }
  const shell = basename(process.env.SHELL || 'sh');
  let profiles;
  let body;
  const posix = `case ":$PATH:" in
  *:${quote(bin)}:*) ;;
  *) export PATH=${quote(bin)}:"$PATH" ;;
esac`;
  if (shell === 'zsh') {
    const zdot = process.env.ZDOTDIR || home;
    if (!isAbsolute(zdot)) throw new Error('ZDOTDIR must be absolute for automatic PATH setup.');
    profiles = [join(zdot, '.zshrc')];
    body = posix;
  } else if (shell === 'bash') {
    const login = ['.bash_profile', '.bash_login', '.profile'].map((f) => join(home, f)).find(existsSync) || join(home, '.profile');
    profiles = [join(home, '.bashrc'), login];
    body = posix;
  } else if (shell === 'fish') {
    const config = process.env.XDG_CONFIG_HOME || join(home, '.config');
    if (!isAbsolute(config)) throw new Error('XDG_CONFIG_HOME must be absolute for automatic PATH setup.');
    profiles = [join(config, 'fish/conf.d/a0-slim.fish')];
    const fishQuote = (s) => "'" + s.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
    body = `if not contains -- ${fishQuote(bin)} $PATH
  set -gx PATH ${fishQuote(bin)} $PATH
end`;
  } else if (['sh', 'dash', 'ksh'].includes(shell)) {
    profiles = [join(home, '.profile')];
    body = posix;
  } else {
    console.log(`Automatic PATH setup is unavailable for ${shell}. Add ${bin} to your shell's PATH.`);
    manual();
    return;
  }
  const marker = '# >>> A0 SLIM PATH >>>';
  for (const profile of profiles) {
    mkdirSync(dirname(profile), { recursive: true, mode: 0o700 });
    // Follow existing dotfile links; append to their target without replacing the link.
    const target = existsSync(profile) ? realpathSync(profile) : profile;
    const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
    if (before.includes(marker)) continue;
    if (existsSync(target)) {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.uid !== process.getuid()) throw new Error(`Cannot safely update ${profile}.`);
      try { copyFileSync(target, `${target}.a0-slim.bak`, constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    appendFileSync(target, `
${marker}
${body}
# <<< A0 SLIM PATH <<<
`, { mode: 0o600 });
    console.log(`PATH configured in ${profile}`);
  }
  console.log('Open a new terminal, then run: a0-slim');
  console.log(`For this terminal now: ${shell === 'fish' ? body.replaceAll('\n', '; ') : `export PATH=${quote(bin)}:"$PATH"`}`);
}
try { register(); }
catch (error) {
  console.log(`Automatic command setup could not finish: ${error.message}`);
  manual();
}
REGISTER
  slim_clean
  slim_stage=; slim_lock=
  trap - EXIT INT TERM HUP
  if [ "$slim_launch" = yes ]; then
    cd "$HOME"
    exec "$slim_root/bin/a0-slim"
  fi
}
main "$@"
