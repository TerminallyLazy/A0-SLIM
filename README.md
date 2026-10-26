# A0 SLIM

A local-first agent workspace inspired by Agent Zero. A Node service runs the agent loop, project tools, memory, and extensions; a browser UI exposes their state and permissions.

**Status: local alpha 0.1.0-alpha.1 with P2 extension and memory preview.** ChatGPT text/functions, reviewed artifacts and optional local Docker execution are implemented. Cloud account acceptance and broader release gates remain open. See [P1 evidence and limitations](docs/verification/P1.md) and [P2 verification](docs/verification/P2.md).

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

## What works

- Projects, saved chats, streaming, transcript replay, message deduplication, Stop and Redirect through native libfx. Redirect stops the active turn, then submits your revised direction.
- AI Gateway and compatible endpoints, including local model servers. Each chat keeps its selected model connection and execution environment; changing defaults affects new chats.
- Dedicated Sign in with ChatGPT registration, account model discovery, encrypted tokens, serialized refresh and disconnect. The text/function bridge preserves completed provider output, encrypted reasoning and message phase in an encrypted local journal. It waits for terminal success before releasing tool calls.
- Scoped file reads and **reviewed text artifacts**. `write_file` stages an immutable preview; only the paired browser can approve its exact content and destination. Conflicts and interrupted writes block further project changes until reconciled.
- Optional **local Docker** execution: disposable Node.js containers, no network, no host-folder mounts or model credentials, non-root user, read-only base image, 128 MiB memory and five seconds per call. Output can become a reviewed artifact. Core chat does not require Docker.
- **Vercel Sandbox, Modal, E2B and Daytona** connection forms and bounded synthetic checks, with official logos, signup/sign-in links, guided credential setup, explicit usage acknowledgment and recovery receipts. Cloud agent execution remains off pending live validation.
- **Skills & MCP:** import, inspect, enable, export, update and roll back project SKILL.md instructions. New native chats load relevant skills through `skills_tool`. Connect Streamable HTTP or explicitly trusted local stdio MCP servers, discover tools, and grant each tool separately. Calls enter an exact-argument approval queue; ambiguous effects block further calls to the server.
- **Agent Zero bridge preview:** the Agent Zero preset connects to its built-in Streamable HTTP MCP endpoint. Store the base URL and encrypted token separately, optionally bind a remote project, discover the exposed tools, and review every call. Python plugins continue running on Agent Zero. A real instance check remains pending.
- **Plugin Hub:** refresh the actual upstream catalog, search it, assess pinned repository trees, and review/import individual portable Markdown skills. No install hooks run. Unknown or Python/UI plugins are never advertised as native Node extensions.
- **Memory:** SQLite/FTS5 project notes in `main`, `fragments`, and `solutions`, with source labels, editing, deletion, portable text import/export, and separate agent read/write permissions. New chats receive bounded lexical recall at turn start and can call `memory_load`, `memory_save`, and `memory_delete`.
- **Embeddings:** explicit pinned Hugging Face MiniLM download (22.6 MiB), checksums, progress, pause/retry, offline verification and removal. CPU inference runs in a worker with network access disabled. Separate compatible `/embeddings` connections require their own credentials and an explicit project data-sharing choice. Reindexing validates dimensions and switches namespaces only after successful completion; lexical search stays available.
- Graphite/Paper themes, three accents, two densities, responsive file/artifact inspector, and original Agent Zero symbols.

### Free sandbox choices

In **Environments**, local Docker uses your computer without cloud compute fees. Start a local Docker-compatible engine and install the pinned Node image shown in the app. No automatic image downloads occur. Engine licensing and local resource costs are separate. Choose Local Docker for new chats in the selected project; existing chats retain their environment.

[Vercel Hobby](https://vercel.com/docs/sandbox/pricing) includes 5 active CPU hours, 420 GB-hours of memory and 5,000 sandbox creations monthly; new creation pauses at its quota. [Modal Starter](https://modal.com/pricing) includes $30 monthly compute credit shared across its compute products; usage beyond the allowance may be billed. The app cannot determine your remaining allowance. Check your provider dashboard before acknowledging a cloud check. Pricing was checked October 26, 2026.

[E2B](https://e2b.dev/pricing) offers $100 one-time credits (no credit card required to start); [Daytona](https://www.daytona.io/pricing) advertises $200 introductory compute. Both now have synthetic check adapters. These are not unlimited or recurring free compute.

Each provider card has **Create account**, **Sign in**, **Open dashboard** and guided credential links. Authenticate on the provider’s site, then save its API key/token in A0 SLIM; no CLI setup is needed. Credentials remain encrypted in the local vault. A browser sign-in does not automatically grant this app access. **Save** makes no cloud request; **Check** requires an explicit usage checkbox. E2B kills its sandbox after 60 seconds; Daytona uses a one-minute lifetime, auto-stop and auto-delete. Cleanup confirms deletion by ID. Unknown creation outcomes block further checks; recovery never creates a replacement. Daytona checks use the US region and the stable SDK, not its v2 alpha.

### Current boundaries

The ChatGPT bridge supports text and function tools. It rejects missing reasoning state, changed/compacted history and unsupported output rather than continuing with incomplete context. Use a new chat with a reviewed summary when that guard stops a conversation. Live reasoning-bearing output, refresh/revocation and quota recovery still need separate account acceptance; synthetic tests cover these contracts.

Model calls share a persisted 40-request/10-minute budget per project, connection and model, with a 10-minute turn limit. These limits are fixed in this alpha. File approval does not isolate the service from another program running as your OS user. Avoid simultaneous edits while applying an artifact; an adversarial OS process is outside this local-user threat boundary.

Start a **new chat** for P2 skills, MCP, and memory tools. Earlier chats retain their original runtime identity and tool set so recovery history remains usable. Capability snapshots freeze each new turn; permission revocation is checked again at tool dispatch. This is functional Agent Zero influence, not full parity: see the [capability comparison](docs/AGENT-ZERO-COMPATIBILITY.md).

Bounded subordinates, native Python plugins, arbitrary cloud agent execution, MCP OAuth/Apps, browser embeddings, automatic document ingestion, shared cross-project memory and executable third-party Slim plugins remain future work. The Agent Zero bridge is protocol-tested with a synthetic server; actual plugin behavior requires checks against the owner’s Agent Zero instance. MCP approvals do not isolate a local stdio process: it runs with the OS user’s authority. Hosted embedding revisions are user-supplied namespace labels; provider-side model changes cannot be independently pinned by this compatible API.

### Using the new capabilities

1. In **Skills & MCP**, review a SKILL.md and import it disabled, then enable it for the selected project. Start a new chat and ask a task relevant to that skill.
2. For MCP, save a connection, discover its catalog, allow selected tools and enable the server. The agent stages a call; open **Approvals** to review its arguments and run it once. Send a follow-up message so the agent retrieves the result.
3. For the Agent Zero bridge, enable **Settings → MCP Server** in Agent Zero. In Slim choose **Agent Zero bridge**, enter only the instance base URL, and put the token in its separate password field. Use HTTPS for non-loopback instances. Never paste a token-bearing MCP URL into the endpoint field.
4. In **Memory**, add notes and decide whether the agent may recall or save/delete them. Embeddings are optional. Use **Embeddings & models** to download MiniLM or add an independent hosted connection, then explicitly build the selected project’s index.

## Storage and development

On macOS, app data lives in `~/Library/Application Support/A0-SLIM`; elsewhere it uses `$XDG_DATA_HOME/A0-SLIM` or `~/.local/share/A0-SLIM`. Override with `A0_SLIM_DATA_DIR`. Use `A0_SLIM_PORT` to change the port. Project files remain in their selected folders. App metadata and conversation journals are local; **credentials and provider protocol journals are encrypted by the application; transcripts, artifact contents, execution output and other metadata are not**. Protect the data directory and its backups with your OS account/disk protections.

```sh
npm run check                 # typecheck, contract/integration tests, production build
npm audit --audit-level=high
npm run dev                   # source server; build the UI first
npm run watch:ui              # rebuild UI in a second terminal; refresh the browser
node --import tsx tests/helpers/docker-live.ts  # optional real local-engine drill; no cloud use
```

`node --import tsx tests/helpers/ui-fixture.ts` starts an isolated browser verification harness on port 4311. It uses a temporary project and a clearly named local model fixture; no provider account is used. Its startup output supplies the test pairing code. Stop with Ctrl+C to remove its temporary data.

Schema 1 upgrades save a private SQLite backup in the data directory before applying schema 2. Back up the entire data directory and preserve its vault key for a complete recovery; a database backup alone does not include libfx session files.

The pinned libfx package receives a small, hash-checked stream-cancellation patch during `npm ci`. Its rationale is in the [P0 record](docs/verification/P0.md). A scoped override upgrades the transitive Zod version inside `@vercel/cli-config`; the lockfile pins the resulting graph.

## Project documents

- [Approved target specification](A0-SLIM-SPEC.md)
- [Decisions and delivery stages](docs/DECISIONS.md)
- [Research and source audit](docs/research/SOURCE-AUDIT.md)
- [Design review artifact](docs/review/index.html) — retained prototype, not the running app
- [Untouched preliminary specification](docs/original/A0-SLIM-SPEC.md)

A0 SLIM is an independent project, not a drop-in replacement for Agent Zero. Original brand assets and dependency attribution are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The Transformers.js runtime loads only in the optional inference worker, but its native/ONNX dependencies are installed with this source distribution. On the tested macOS checkout, Transformers.js, onnxruntime-node and onnxruntime-web occupy approximately 441 MiB together, excluding the 22.6 MiB model. This is not a tiny standalone executable; optional runtime packaging remains a release task. Model weights live under the private app data directory and are never committed.
