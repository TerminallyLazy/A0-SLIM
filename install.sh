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
  env -i HOME="$slim_root/npm-home" PATH="$slim_node_dir:$PATH" "$slim_node" --input-type=module - "$1" <<'JS'
import { createRequire } from 'node:module';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = join(process.argv[2], 'node_modules/a0-slim');
const require = createRequire(join(base, 'package.json'));
if (require('./package.json').version !== '0.1.0-alpha.1') throw new Error('Unexpected app version');
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
  slim_hash=34da076b90f62389870862c7b77359e95dfa117b3c3fe129bb555cd0dc1a9a71
  if [ -f "$slim_root/current/.verified-tarball" ] && [ "$(cat "$slim_root/current/.verified-tarball")" = "$slim_hash" ]; then
    printf 'Checking the existing A0 SLIM installation…\n'
    slim_probe "$slim_root/current" || slim_fail 'The existing installation needs repair. Your app data has not been changed.'
  else
    printf 'Downloading and installing A0 SLIM 0.1.0-alpha.1…\n'
    slim_download 'https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.1.tgz' "$slim_stage/a0-slim.tgz" "$slim_hash"
    mkdir "$slim_stage/app"
    cat > "$slim_stage/app/package.json" <<'JSON'
{"private":true}
JSON
    (cd "$slim_stage/app" && slim_npm install "$slim_stage/a0-slim.tgz" --omit=dev --ignore-scripts --no-audit --no-fund) || slim_fail 'Installation failed. Re-run this command to retry; the previous installation and app data are preserved.'
    slim_probe "$slim_stage/app" || slim_fail 'The installed native runtime failed verification; it was not activated.'
    printf '%s\n' "$slim_hash" > "$slim_stage/app/.verified-tarball"
    slim_release=$slim_root/releases/0.1.0-alpha.1-$(basename "$slim_stage")
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
  cat > "$slim_stage/launch.mjs" <<'JS'
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
const args = process.argv.slice(2);
const url = `http://127.0.0.1:${process.env.A0_SLIM_PORT ?? '4310'}`;
function openBrowser() {
  if (process.env.A0_SLIM_NO_BROWSER === '1' || args.includes('--no-open')) return;
  const command = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
  const browser = spawn(command, [url], { stdio: 'ignore', detached: true });
  browser.on('error', () => {}); // A headless system can use the printed URL.
  browser.unref();
}
// An explicit data directory requests that workspace, not whichever service owns this port.
if (!process.env.A0_SLIM_DATA_DIR && !args.includes('--help')) {
  try {
    const response = await fetch(`${url}/api/v1/status`, { signal: AbortSignal.timeout(700) });
    const status = await response.json();
    if (response.ok && status.version === '0.1.0-alpha.1' && status.stage === 'P2 preview · account checks pending' && typeof status.paired === 'boolean') {
      console.log(`A0 SLIM is already running at ${url}. Its original terminal holds the pairing code.`);
      openBrowser();
      process.exit(0);
    }
  } catch { /* Start normally when no recognizable server is listening. */ }
}
const child = spawn(process.execPath, [join(root, 'current/node_modules/a0-slim/bin/a0-slim.mjs'), ...args], { stdio: ['inherit', 'pipe', 'inherit'], env: { ...process.env, A0_SLIM_NO_BROWSER: '1' } });
let ready = '', opened = false;
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (opened || args.includes('--help')) return;
  ready = (ready + chunk.toString()).slice(-4096);
  if (!ready.includes('Pair this browser within 10 minutes:')) return;
  opened = true;
  openBrowser();
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(`A0 SLIM could not start: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
JS
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
  slim_clean
  slim_stage=; slim_lock=
  trap - EXIT INT TERM HUP
  if [ "$slim_launch" = yes ]; then
    cd "$HOME"
    exec "$slim_root/bin/a0-slim"
  fi
}
main "$@"
