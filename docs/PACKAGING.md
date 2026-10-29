# npm packaging

The public package is named `a0-slim`, licensed MIT, and versioned `0.1.0-alpha.5`. It remains an alpha; the `latest` npm tag identifies the current release, not a stability guarantee. Manual npm installation requires Node 24 and npm 11.19 or newer; the one-command installer sets up a private runtime when needed. macOS arm64 and Linux x64 are the tested targets.

## One-command installer

```sh
curl -fsSL https://raw.githubusercontent.com/TerminallyLazy/A0-SLIM/main/install.sh | sh
```

The script supports Apple Silicon macOS and Linux x64 with glibc. It reuses Node 24 and npm 11.19+ within npm 11; otherwise it downloads Node 24.22.1 from `nodejs.org`. The official archive SHA-256 values and app tarball hash are pinned in the script. Unsupported platforms and root execution stop before setup. Node is separate from the core package footprint; no global Node installation is replaced.

Installation uses `~/.local/share/a0-slim-cli` or `$XDG_DATA_HOME/a0-slim-cli`. Set `A0_SLIM_INSTALL_DIR` on the `sh` side of the pipe for a custom absolute path. npm runs in private storage with an empty configuration and a minimal environment, without inherited npm credentials. It installs the published alpha with all npm lifecycle scripts blocked. The pinned SQLite/CBOR packages already contain their supported native prebuilds; the installer loads those directly instead of invoking node-gyp. Native SQLite, CBOR and libfx must pass a probe before the release becomes active. No Python/compiler setup is needed on these supported targets. The launcher applies the same hash-checked libfx patch as the npm CLI.

A failed download, checksum mismatch or failed native probe leaves the existing active release and app data intact. A directory lock excludes simultaneous installers. Normal interruption removes the staging directory and lock; after a hard kill, inspect the installer processes before removing its empty `.install-lock` directory. Only then retry. Completed releases are retained under `releases`; re-running a healthy installation reuses it without downloads and preserves a verified newer release. The managed launcher checks for updates before startup, at most once a day; `a0-slim update` checks immediately. See [updates and recovery](UPDATES.md). The script executes its main function only after the full function definitions have been read.

The installer registers `~/.local/bin/a0-slim` as a link to its persistent private launcher, normally `~/.local/share/a0-slim-cli/bin/a0-slim`. Repeated installation keeps that link; an unrelated existing file/link is never replaced. When `~/.local/bin` is absent from PATH, setup appends one marked block to the active shell’s startup file: zsh `.zshrc` (respecting `ZDOTDIR`), Bash `.bashrc` and its selected login profile, POSIX `.profile`, or Fish `conf.d/a0-slim.fish` (respecting `XDG_CONFIG_HOME`). Existing contents and dotfile links are preserved; the first edit makes an adjacent `.a0-slim.bak` backup. Unsupported shells or unwritable configuration retain a working direct launch path and print instructions. No system shell configuration is changed.

Open a new terminal after first-time PATH setup, then run `a0-slim`. The installer also prints an export command for the current terminal because a child process cannot change its parent shell’s environment. The service runs in the foreground; Ctrl+C reaches the child service and releases its data lock. When startup succeeds, the launcher opens the loopback URL in the system browser; the pairing code stays in the terminal. `A0_SLIM_NO_BROWSER=1` or `--no-open` disables browser opening. `A0_SLIM_NO_UPDATE=1` skips the automatic update check for a launch. The npm CLI also opens the browser directly. An already-running SLIM instance on the selected port can be reused when no explicit data directory was requested. A custom `A0_SLIM_DATA_DIR` always starts that requested workspace and retains normal port/data ownership checks.

Use `curl -fsSL https://raw.githubusercontent.com/TerminallyLazy/A0-SLIM/main/install.sh | sh -s -- --no-launch` to install without launching. `A0_SLIM_PORT` and `A0_SLIM_DATA_DIR` can also be set on the `sh` side of the pipe. The script never installs embeddings, weights or Microsandbox automatically.

`npm run test:installer` performs actual installs with an existing compatible Node and with Node absent from PATH, using isolated homes and a path containing spaces/apostrophes. It proves the registered bare command works with the generated shell profile, starts and pairs the real app, checks UI/native readiness, tests existing-service reuse and clean shutdown, and repeats setup with downloads disabled. It uses no model account or cloud sandbox. Offline regression tests cover unsupported systems, root execution, truncated input, concurrent installation and a tampered Node archive.

### Command setup verification (2026-10-29)

Node 24 validation passed: 157 repository tests, typecheck and production build; dependency audit reported zero vulnerabilities. Actual installer runs with an existing Node/npm runtime and a downloaded private runtime both registered the bare `a0-slim` command, launched and paired the app, reused the running instance, stopped cleanly, and repeated successfully with downloads disabled. Regression checks cover Bash/zsh profile preservation, linked dotfiles, backups, spaces/apostrophes, idempotence and unrelated command preservation. Fish configuration generation is checked; live Fish startup is not claimed. The existing owner installation was repaired through the same registration code and `a0-slim --help` succeeded.

## Install from npm

```sh
npm install -g a0-slim@0.1.0-alpha.5 --allow-scripts=better-sqlite3@13.0.3,cbor-extract@2.2.2
a0-slim
```

The allowance is limited to the pinned SQLite/CBOR native builds. Do not use `--allow-scripts=*`. Use a user-writable Node installation instead of `sudo`. The CLI applies its hash-checked libfx patch when first started, even when its own postinstall hook was blocked. Starting the app never downloads model weights or optional runtimes.

For a dedicated local installation, use the directory steps below and replace the tarball path with `a0-slim@0.1.0-alpha.5`.

## Download with curl

Download the exact release tarball:

```sh
curl -fL -o a0-slim-0.1.0-alpha.5.tgz https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.5.tgz
```

Then install it with Node 24 and npm 11.19 or newer:

```sh
npm install -g ./a0-slim-0.1.0-alpha.5.tgz --allow-scripts=better-sqlite3@13.0.3,cbor-extract@2.2.2
a0-slim
```

npm installs production dependencies separately. Release checks and artifact integrity are recorded in `docs/verification/`.

## Build and install a tarball

From the checkout:

```sh
npm ci
npm pack
```

`prepack` performs a clean production build. The tarball contains the CLI, compiled server/UI, attribution, `npm-shrinkwrap.json` and the small optional embedding, Microsandbox and native-plugin recipes. It excludes tests, source tooling, private data, development dependencies and model weights. The UI retains React, Markdown/GFM and icons; their full dependency license texts ship beside the browser assets.

Install the resulting file into a dedicated directory:

```sh
mkdir slim-install
cd slim-install
npm init -y
npm install /absolute/path/a0-slim-0.1.0-alpha.5.tgz --omit=dev
```

Recent npm versions block unapproved dependency scripts. If npm reports blocked SQLite/CBOR scripts, approve their pinned installed versions and rebuild them in this directory:

```sh
npm install-scripts approve better-sqlite3 cbor-extract
npm rebuild better-sqlite3 cbor-extract
npx --no-install a0-slim
```

With npm versions that already ran those scripts, only the launch command is needed. The repository records approvals for the pinned native dependencies used by `npm ci`; a consuming project owns its own approvals. See [npm's script approval documentation](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/). The launcher checks/applies the exact libfx cancellation patch even if its install hook was skipped. It does not bypass npm's native-build policy.

First launch guides account/model selection and a project folder; the native agent is included. Microsandbox, external ACP agents and local embeddings remain optional. See [first-run setup](FIRST-RUN.md).

The service defaults to `http://127.0.0.1:4310`. `A0_SLIM_PORT` and `A0_SLIM_DATA_DIR` override the port and private storage location. To run an independent second instance, choose both a different port and data directory:

```sh
A0_SLIM_PORT=4311 A0_SLIM_DATA_DIR="$HOME/.local/share/a0-slim-second" a0-slim
```

Running `a0-slim` by itself starts the default instance or reopens it when it is already running. Each independent instance has its own pairing and saved state. Pairing, vault custody, recovery receipts and sandbox permissions are unchanged.

## Optional local embeddings

Core installation needs neither PyTorch nor Transformers.js. Local MiniLM inference uses **Transformers.js 4.3.1 and ONNX Runtime CPU**, installed separately from **Memory → Embeddings & models → Install local embeddings**. Hosted `/embeddings` connections and lexical memory work without this runtime. Chat subscriptions do not supply embedding credentials.

Installation downloads the separate integrity-pinned npm graph with dependency scripts disabled, without inherited npm credentials/configuration. It stages files and probes the native CPU binding in a separate process before activation. Cancellation waits for child shutdown. Interrupted installs remain visible after restart and can be retried or removed. Installation has a 10-minute deadline; the probe has 30 seconds. Startup and search never install or repair automatically.

Runtime files live under `<data>/addons/local-embeddings`; weights live separately under `<data>/models`. Installing the runtime does not download a model. **Download & verify** explicitly retrieves the 23,685,172-byte MiniLM model, validates checksums and runs offline inference. Runtime removal preserves model files, notes, vectors and namespace selection. Local semantic search falls back to lexical results; reinstalling restores access to the existing model/index. Removing weights remains a separate action.

## Optional native Hub plugins

The core includes the SLIM plugin worker and pinned runtime/source recipes. The Hub explicitly downloads standalone Python and DB Hub dependencies only when the user installs support. Agent Zero is not required. Initial coverage is read-only SQLite status/schema; see [setup and limits](NATIVE-PLUGINS.md). `npm run test:package -- --plugins` tests real plugin execution from the installed artifact with synthetic model/data fixtures and explicit public downloads.

## Measured footprint

Measured October 26, 2026 on macOS arm64, Node 24.22.1/npm 11.19.1, with a real tarball and fresh production install. Decimal MB; rounded because documentation changes slightly alter the tarball.

| Component | File bytes | Allocated disk |
| --- | ---: | ---: |
| App `.tgz` before extraction | ~0.47 MB | ~0.47 MB |
| App extracted, excluding dependencies | ~1.97 MB | filesystem dependent |
| Core with production dependencies | ~202 MB | ~262 MB |
| Optional Microsandbox SDK/runtime, additional | ~97 MB | ~97 MB |
| Microsandbox Node image/cache after one check, additional | ~174 MB | ~174 MB |
| Optional embedding runtime, additional | ~484 MB | ~494 MB |
| Optional MiniLM model, additional | ~24 MB | ~24 MB |

The previous production dependency set occupied about 725 MB of file bytes / 808 MB allocated. The lean core reduces file bytes by about **72%**. npm fetches dependencies separately; this is not a 0.47 MB total installation. Totals exclude Node/npm, npm caches, developer tooling, personal projects, saved chats, Docker images and separately installed agents. Platforms and filesystem allocation differ. Both ONNX Node and Web assets remain within Transformers.js's supported graph; library-internal assets are not selectively pruned.

## Verification

`npm run check` covers TypeScript, regression tests, production build and synchronization of generated installer modules. `npm run test:update` verifies an automatic startup update using an exact local tarball, synthetic registry metadata and a real dependency install, then starts and pairs the updated app while preserving prior release/data sentinels. `npm run test:package` packs and installs into temporary directories, checks shrinkwraps/licenses, proves ML/UI build packages cannot resolve from core, starts the CLI twice, serves the UI, uses SQLite, loads native libfx and cancels an early stream. It installs/removes the actual optional runtime and probes its CPU binding. CI runs this on Linux and macOS; Windows is not an accepted target.

The explicit `npm run test:package -- --with-model` adds a public model download, checksums, actual offline embeddings, runtime removal/reinstallation and reuse of the retained model. It is not in default CI. The local check returned 384-dimensional unit vectors with cosine similarity 0.954691 for two equivalent synthetic garden sentences. No ChatGPT allowance, provider credentials, project files or cloud sandbox were used.

Browser review covered absent/installed runtime states, explicit download selection, cancellation/retry and removal in a disposable workspace. Cancellation during native probe initialization originally terminated the host; moving that probe to a subprocess and adding child-failure/cancellation coverage fixed the failure.

## Optional Microsandbox

The core has no `microsandbox`, `@microsandbox/types` or platform-native Microsandbox dependency. Its allowlist includes only the add-on package manifest, shrinkwrap, worker and runtime configuration. Environments performs the explicit, integrity-pinned installation with npm scripts disabled and a separate image download. The Apple Silicon platform package is about 96 MB unpacked before the image/cache. Native code runs only in an isolated child process. See [setup, storage and recovery](MICROSANDBOX.md).

The packaging smoke test checks the installed CLI's Microsandbox endpoint and verifies that neither the SDK nor the Apple Silicon native module resolves from the core installation. Local VM acceptance is opt-in and stays out of ordinary CI.

## Release process

1. Run `npm ci`, `npm run check`, `npm run test:package` and the root/add-on high-severity audits. Review only the intended changes and commit them.
2. Build from the committed source in a clean checkout. Run `npm pack`; inspect its file list, license, version and integrity. Never pack the working app's private data or unrelated local edits.
3. Test that exact artifact with `npm run test:package -- --package /absolute/path/a0-slim-0.1.0-alpha.5.tgz --global-install`. This uses an isolated home/prefix and the documented native-script approvals, starts the real CLI twice, and removes its temporary installation afterward.
4. With the owner's npm session, publish that tested tarball using `npm publish /absolute/path/a0-slim-0.1.0-alpha.5.tgz --access public --tag latest`. A new version requires a deliberate version change; never overwrite or unpublish an existing release as a retry.
5. Verify public registry metadata and tarball integrity, then repeat the install check with `--package a0-slim@0.1.0-alpha.5 --global-install`. Record the release's source commit, checks, package sizes and integrity. Tag the verified source commit and publish its release notes.

Publication is an explicit maintainer action. CI builds/tests on Linux and macOS; a green CI job does not publish. Authentication and any required npm 2FA stay in the owner's npm flow, never in repository files or logs.

## Optional OpenShell

The core bundles only the OpenShell install manifest, SLIM worker and setup guide. `@nvidia/openshell-sdk@0.1.6` is not a core dependency. Its authenticated GitHub Packages installation is performed explicitly in the displayed add-on directory, with lifecycle scripts disabled; the user's local lockfile records the resolved dependency graph. No gateway, image or VM runtime is downloaded by core install. See [OpenShell setup](OPENSHELL.md). The package smoke check asserts the worker/guide are present, the SDK cannot resolve from core, and the installed CLI reports an unconfigured optional connection.
