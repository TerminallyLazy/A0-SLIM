# A0 SLIM

A local-first agent workspace inspired by Agent Zero. A Node service owns the work; a calm, customizable browser UI gives it a home.

**Status: working P0 foundation. P0 acceptance and the P1 alpha are not complete.** See the [verification record](docs/verification/P0.md) for tested behavior and remaining gates.

## Run locally

Use **Node 24** (the tested version is in `.node-version`). Then:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4310` and enter the one-time pairing code printed in the terminal. The code expires after 10 minutes; the paired browser session lasts up to eight hours. Restarting the service issues a new code. The service binds only to IPv4 loopback; remote hosting is not supported.

Add a focused project folder, then add a compatible model endpoint or AI Gateway connection. For Ollama/LM Studio, use the server's compatible `/v1` base URL and a tool-capable model. Model names and credentials belong to your provider. Saving a connection does not verify inference or incur an inference request. The first **Send** creates the durable runtime session.

Closing the tab detaches the viewer; **Stop** cancels the current model turn. Stopping the local service stops its work. A second service cannot own the same data directory.

## What works in this foundation

- Project folders, saved chats, streamed text and tool activity, transcript replay, message deduplication, and cancellation through the native libfx runtime.
- Read-only `list_dir` and `read_file` tools with bounded text reads and path/symlink checks. Shell execution and writes are disabled.
- AI Gateway configuration and custom Chat Completions endpoints. Synthetic inference is verified; no live provider acceptance is claimed.
- Dedicated ChatGPT registration code, PKCE/state/nonce, ID-token verification, account model discovery, serialized refresh, and disconnect. The experimental Responses bridge supports text/functions; it rejects reasoning items until state replay is implemented.
- Encrypted credential storage. macOS uses an application-owned Keychain entry for its vault key. On other systems, supply a stable base64-encoded 32-byte `A0_SLIM_VAULT_KEY` through your secret-management environment. Do not commit that key or store it in the project.
- A Vercel Sandbox synthetic proof action with explicit usage acknowledgment, a 60-second TTL, persistence disabled, denied outbound network, and cleanup receipts. It does not enable agent execution.
- Original Agent Zero symbols, Graphite/Paper themes, three accents, two densities, a file inspector, and a responsive workspace.

**Open gates:** ChatGPT reasoning-state replay and live-account validation; reconciliation of uncertain side effects before enabling writes/execution; real sandbox lifecycle/cleanup; platform distribution and security acceptance. The crash test intentionally documents that libfx's non-idempotent metadata alone does not prevent a model from requesting an uncertain action again.

Memory, embeddings/model downloads, delegation, skills/MCP, Plugin Hub discovery, additional sandboxes, approvals and writable artifacts remain planned. Their UI entries are explicitly labeled as planned.

## Storage and development

On macOS, app data lives in `~/Library/Application Support/A0-SLIM`; elsewhere it uses `$XDG_DATA_HOME/A0-SLIM` or `~/.local/share/A0-SLIM`. Override with `A0_SLIM_DATA_DIR`. Use `A0_SLIM_PORT` to change the port. Project files remain in their selected folders. App metadata and conversation journals are local; **only credential records are encrypted by the application**. Protect the data directory and its backups with your OS account/disk protections.

```sh
npm run check                 # typecheck, contract/integration tests, production build
npm audit --audit-level=high
npm run dev                   # source server; build the UI first
npm run watch:ui              # rebuild UI in a second terminal; refresh the browser
```

`node --import tsx tests/helpers/ui-fixture.ts` starts an isolated browser verification harness on port 4311. It uses a temporary project and a clearly named local model fixture; no provider account is used. Its startup output supplies the test pairing code. Stop with Ctrl+C to remove its temporary data.

The pinned libfx package receives a small, hash-checked stream-cancellation patch during `npm ci`. Its rationale is in the [P0 record](docs/verification/P0.md). A scoped override upgrades the transitive Zod version inside `@vercel/cli-config`; the lockfile pins the resulting graph.

## Project documents

- [Approved target specification](A0-SLIM-SPEC.md)
- [Decisions and delivery stages](docs/DECISIONS.md)
- [Research and source audit](docs/research/SOURCE-AUDIT.md)
- [Design review artifact](docs/review/index.html) — retained prototype, not the running app
- [Untouched preliminary specification](docs/original/A0-SLIM-SPEC.md)

A0 SLIM is an independent project, not a drop-in replacement for Agent Zero. Original brand assets and dependency attribution are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
