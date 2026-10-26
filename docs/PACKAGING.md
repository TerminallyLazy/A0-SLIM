# npm packaging

The CLI package is built and tested locally; it has not been published to npm. `private: true` remains set until a registry name, project license and public release are finalized. Node 24 and npm are prerequisites, installed separately.

## Build and install a tarball

From the checkout:

```sh
npm ci
npm pack
```

`prepack` performs a clean production build. The tarball contains the CLI, compiled server/UI, attribution, `npm-shrinkwrap.json` and the small optional embedding and Microsandbox recipes. It excludes tests, source tooling, private data, development dependencies and model weights. The UI retains React, Markdown/GFM and icons; their full dependency license texts ship beside the browser assets.

Install the resulting file into a dedicated directory:

```sh
mkdir slim-install
cd slim-install
npm init -y
npm install /absolute/path/a0-slim-0.1.0-alpha.1.tgz --omit=dev
```

Recent npm versions block unapproved dependency scripts. If npm reports blocked SQLite/CBOR scripts, approve their pinned installed versions and rebuild them in this directory:

```sh
npm install-scripts approve better-sqlite3 cbor-extract
npm rebuild better-sqlite3 cbor-extract
npx --no-install a0-slim
```

With npm versions that already ran those scripts, only the launch command is needed. The repository records approvals for the pinned native dependencies used by `npm ci`; a consuming project owns its own approvals. See [npm's script approval documentation](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/). The launcher checks/applies the exact libfx cancellation patch even if its install hook was skipped. It does not bypass npm's native-build policy.

The service defaults to `http://127.0.0.1:4310`. `A0_SLIM_PORT` and `A0_SLIM_DATA_DIR` override the port and private storage location. Pairing, vault custody, recovery receipts and sandbox permissions are unchanged.

## Optional local embeddings

Core installation needs neither PyTorch nor Transformers.js. Local MiniLM inference uses **Transformers.js 4.3.1 and ONNX Runtime CPU**, installed separately from **Memory → Embeddings & models → Install local embeddings**. Hosted `/embeddings` connections and lexical memory work without this runtime. Chat subscriptions do not supply embedding credentials.

Installation downloads the separate integrity-pinned npm graph with dependency scripts disabled, without inherited npm credentials/configuration. It stages files and probes the native CPU binding in a separate process before activation. Cancellation waits for child shutdown. Interrupted installs remain visible after restart and can be retried or removed. Installation has a 10-minute deadline; the probe has 30 seconds. Startup and search never install or repair automatically.

Runtime files live under `<data>/addons/local-embeddings`; weights live separately under `<data>/models`. Installing the runtime does not download a model. **Download & verify** explicitly retrieves the 23,685,172-byte MiniLM model, validates checksums and runs offline inference. Runtime removal preserves model files, notes, vectors and namespace selection. Local semantic search falls back to lexical results; reinstalling restores access to the existing model/index. Removing weights remains a separate action.

## Measured footprint

Measured October 26, 2026 on macOS arm64, Node 24.22.1/npm 11.19.1, with a real tarball and fresh production install. Decimal MB; rounded because documentation changes slightly alter the tarball.

| Component | File bytes | Allocated disk |
| --- | ---: | ---: |
| App `.tgz` before extraction | ~0.44 MB | ~0.44 MB |
| App extracted, excluding dependencies | ~1.85 MB | filesystem dependent |
| Core with production dependencies | ~202 MB | ~262 MB |
| Optional Microsandbox SDK/runtime, additional | ~97 MB | ~97 MB |
| Microsandbox Node image/cache after one check, additional | ~174 MB | ~174 MB |
| Optional embedding runtime, additional | ~484 MB | ~494 MB |
| Optional MiniLM model, additional | ~24 MB | ~24 MB |

The previous production dependency set occupied about 725 MB of file bytes / 808 MB allocated. The lean core reduces file bytes by about **72%**. npm fetches dependencies separately; this is not a 0.44 MB total installation. Totals exclude Node/npm, npm caches, developer tooling, personal projects, saved chats, Docker images and separately installed agents. Platforms and filesystem allocation differ. Both ONNX Node and Web assets remain within Transformers.js's supported graph; library-internal assets are not selectively pruned.

## Verification

`npm run check` covers TypeScript, regression tests and production build. `npm run test:package` packs and installs into temporary directories, checks shrinkwraps/licenses, proves ML/UI build packages cannot resolve from core, starts the CLI twice, serves the UI, uses SQLite, loads native libfx and cancels an early stream. It installs/removes the actual optional runtime and probes its CPU binding. CI runs this on Linux and macOS; Windows is not an accepted target.

The explicit `npm run test:package -- --with-model` adds a public model download, checksums, actual offline embeddings, runtime removal/reinstallation and reuse of the retained model. It is not in default CI. The local check returned 384-dimensional unit vectors with cosine similarity 0.954691 for two equivalent synthetic garden sentences. No ChatGPT allowance, provider credentials, project files or cloud sandbox were used.

Browser review covered absent/installed runtime states, explicit download selection, cancellation/retry and removal in a disposable workspace. Cancellation during native probe initialization originally terminated the host; moving that probe to a subprocess and adding child-failure/cancellation coverage fixed the failure.

## Optional Microsandbox

The core has no `microsandbox`, `@microsandbox/types` or platform-native Microsandbox dependency. Its allowlist includes only the add-on package manifest, shrinkwrap, worker and runtime configuration. Environments performs the explicit, integrity-pinned installation with npm scripts disabled and a separate image download. The Apple Silicon platform package is about 96 MB unpacked before the image/cache. Native code runs only in an isolated child process. See [setup, storage and recovery](MICROSANDBOX.md).

The packaging smoke test checks the installed CLI's Microsandbox endpoint and verifies that neither the SDK nor the Apple Silicon native module resolves from the core installation. Local VM acceptance is opt-in and stays out of ordinary CI.
