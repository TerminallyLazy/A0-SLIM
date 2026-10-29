# A0 SLIM

A local-first agent workspace inspired by Agent Zero. A Node service runs the agent loop, project tools, memory, and extensions; a browser UI exposes their state and permissions.

**Status: alpha 0.1.0-alpha.2 with guided first-run setup, native Bash, P2 extensions, memory and bounded subordinates.** ChatGPT text/functions, reviewed artifacts, optional local Docker execution and bounded Vercel Node.js execution are implemented. Cloud account acceptance and broader release gates remain open. See [P1 evidence and limitations](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/verification/P1.md) and [P2 verification](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/verification/P2.md).

## Install and launch with one command

On **Apple Silicon macOS or Linux x64 (glibc)**:

```sh
curl -fsSL https://raw.githubusercontent.com/TerminallyLazy/A0-SLIM/main/install.sh | sh
```

This installs A0 SLIM, opens the browser when available, and keeps the service running in your terminal. Enter the pairing code printed there. Press **Ctrl+C** to stop. If A0 SLIM is already running on the default workspace/selected port, the launcher opens that instance instead.

The installer reuses Node 24 with compatible npm 11.19+ (11.x). Otherwise it downloads a private, checksum-verified Node 24.22.1 runtime. No `sudo`, global Node replacement or shell-profile changes are needed. Files live in `~/.local/share/a0-slim-cli` (or `$XDG_DATA_HOME/a0-slim-cli`); app data remains in its normal location. The terminal prints the exact command for starting again, normally:

```sh
~/.local/share/a0-slim-cli/bin/a0-slim
```

Optional embeddings, model weights and Microsandbox still require separate setup in the app. See [installer options and recovery](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/PACKAGING.md#one-command-installer).

## Install with your own Node and npm

Use **Node 24** and npm 11.19 or newer. macOS arm64 and Linux x64 are the tested targets. This is an alpha release.

```sh
npm install -g a0-slim@0.1.0-alpha.2 --allow-scripts=better-sqlite3@13.0.3,cbor-extract@2.2.2
a0-slim
```

The script allowance builds the two pinned native dependencies. Other dependency install scripts stay blocked. The launcher verifies the bundled libfx compatibility patch. Use a user-writable Node installation; do not run the app with `sudo`. See [installation alternatives and package size](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/PACKAGING.md).

Open `http://127.0.0.1:4310` and enter the one-time pairing code printed in the terminal. The code expires after 10 minutes; the paired browser session lasts up to eight hours. Restarting the service issues a new code. The service binds only to IPv4 loopback; remote hosting is not supported.

The browser opens automatically. Pair it with the code in your terminal, then follow **Connect a model → Choose a workspace → Start working**. Sign in with ChatGPT, or use an API key/local model. Choose an account model and create a new `~/SLIM Workspace` folder or select an existing project. SLIM includes its own native agent: a separate Agent Zero installation is optional. Setup saves your choices without sending project contents or running inference; your first message starts the model request. ChatGPT support is experimental and depends on the models available to your account.

Optional **Add local Bash** installs Microsandbox and checks one temporary local VM before enabling it for the project. You can start chatting without any sandbox and configure execution later. Host Bash always requires an explicit project permission. See [first-run setup](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/FIRST-RUN.md).

Closing the tab detaches the viewer; **Stop** cancels the current model turn. Stopping the local service stops its work. A second service cannot own the same data directory.

### Download with curl

Download the exact release tarball:

```sh
curl -fL -o a0-slim-0.1.0-alpha.2.tgz https://github.com/TerminallyLazy/A0-SLIM/releases/download/v0.1.0-alpha.2/a0-slim-0.1.0-alpha.2.tgz
```

Then install it with Node 24 and npm 11.19 or newer:

```sh
npm install -g ./a0-slim-0.1.0-alpha.2.tgz --allow-scripts=better-sqlite3@13.0.3,cbor-extract@2.2.2
a0-slim
```

The download is about 470 KB; npm installs production dependencies separately. The GitHub asset and npm release use the same tested tarball. The exact SHA-256 is in the release’s `SHA256SUMS` asset.

## What works

- Projects, saved chats, streaming, Markdown assistant replies, transcript replay, message deduplication, Stop and Redirect through native libfx. Redirect stops the active turn, then submits your revised direction.
- AI Gateway and compatible endpoints, including local model servers. Each chat keeps its selected model connection and execution environment; changing defaults affects new chats.
- Dedicated Sign in with ChatGPT registration, account model discovery, encrypted tokens, serialized refresh and disconnect. The text/function bridge preserves completed provider output, encrypted reasoning and message phase in an encrypted local journal. It waits for terminal success before releasing tool calls.
- Scoped file reads and **reviewed text artifacts**. `write_file` stages an immutable preview; only the paired browser can approve its exact content and destination. Conflicts and interrupted writes block further project changes until reconciled.
- Optional **local Docker** execution: disposable Node.js containers, no network, no host-folder mounts or model credentials, non-root user, read-only base image, 128 MiB memory and five seconds per call. Output can become a reviewed artifact. Core chat does not require Docker.
- **Vercel Sandbox, Modal, E2B and Daytona** connection forms and bounded synthetic checks, with official logos, signup/sign-in links, guided credential setup, explicit usage acknowledgment and recovery receipts. Vercel supports native chat code calls; the other three providers currently support synthetic checks only.
- **Skills & MCP:** import, inspect, enable, export, update and roll back project SKILL.md instructions. New native chats load relevant skills through `skills_tool`. Connect Streamable HTTP or explicitly trusted local stdio MCP servers, discover tools, and grant each tool separately. Calls enter an exact-argument approval queue; ambiguous effects block further calls to the server.
- **External agents over ACP:** choose an Agent Zero or custom stdio agent for a new chat. Separate saved sessions, Markdown streaming, tool activity, one-time permission decisions and conservative recovery. Native SLIM/libfx and MCP remain available. See [ACP setup and boundaries](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/ACP.md).
- **Agent Zero MCP tools preview:** the Agent Zero preset connects to its built-in Streamable HTTP MCP endpoint. Store the base URL and encrypted token separately, optionally bind a remote project, discover the exposed tools, and review every call. Python plugins continue running on Agent Zero. A real instance check remains pending.
- **Plugin Hub:** refresh the actual upstream catalog, search it, assess pinned repository trees, and review/import individual portable Markdown skills. No install hooks run. Unknown or Python/UI plugins are never advertised as native Node extensions.
- **Memory:** SQLite/FTS5 project notes in `main`, `fragments`, and `solutions`, with source labels, editing, deletion, portable text import/export, and separate agent read/write permissions. New chats receive bounded lexical recall at turn start and can call `memory_load`, `memory_save`, and `memory_delete`.
- **Embeddings:** optional local inference runtime installed from Memory → Embeddings & models, followed by an explicit pinned Hugging Face MiniLM download (22.6 MiB). Installation supports cancellation, retry and removal; model files have checksums, progress, pause/retry and offline verification. CPU inference runs in a worker with network fetch disabled. Separate compatible `/embeddings` connections require their own credentials and an explicit project data-sharing choice. Reindexing validates dimensions and switches namespaces only after successful completion; lexical search stays available.
- **Subordinates:** new chats can delegate read-only research/review through `call_subordinate`, inspect each child transcript, stop its work and continue the same child from its parent. Children inherit the project, model connection and a subset of permitted skills/recall; they cannot write, execute code or call MCP.
- Graphite/Paper themes, three accents, two densities, responsive file/artifact inspector, and original Agent Zero symbols.

### Free sandbox choices

In **Environments**, local Docker uses your computer without cloud compute fees. Start a local Docker-compatible engine and install the pinned Node image shown in the app. No automatic image downloads occur. Engine licensing and local resource costs are separate. Choose Local Docker for new chats in the selected project; existing chats retain their environment. Alternatively, choose **Vercel Sandbox · Node.js** above the provider cards after a passing Vercel check, approve the selected project’s code/input transfer and compute use, then start a new chat. Vercel execution does not require Docker. Use **Revoke Vercel usage** to block future calls from that project.

[Vercel Hobby](https://vercel.com/docs/sandbox/pricing) includes 5 active CPU hours, 420 GB-hours of memory and 5,000 sandbox creations monthly; new creation pauses at its quota. [Modal Starter](https://modal.com/pricing) includes $30 monthly compute credit shared across its compute products; usage beyond the allowance may be billed. The app cannot determine your remaining allowance. Check your provider dashboard before acknowledging a cloud check. Pricing was checked October 26, 2026.

[E2B](https://e2b.dev/pricing) offers $100 one-time credits (no credit card required to start); [Daytona](https://www.daytona.io/pricing) advertises $200 introductory compute. Both now have synthetic check adapters. These are not unlimited or recurring free compute.

Each provider card has **Create account**, **Sign in**, **Open dashboard** and guided credential links. Authenticate on the provider’s site, then save its API key/token in A0 SLIM; no CLI setup is needed. Credentials remain encrypted in the local vault. A browser sign-in does not automatically grant this app access. **Save** makes no cloud request; **Check** requires an explicit usage checkbox. E2B kills its sandbox after 60 seconds; Daytona uses a one-minute lifetime, auto-stop and auto-delete. Cleanup confirms deletion by ID. Unknown creation outcomes block further checks; recovery never creates a replacement. Daytona checks use the US region and the stable SDK, not its v2 alpha.

Vercel setup retains the Team and Project IDs when reopened. Leave the token blank to keep the saved token. A team slug is resolved to its canonical ID through an authenticated project lookup before compute starts. If an earlier check is stuck with an unknown outcome, use **Recheck & clean up**. For an absent resource, **Record a provider review** requires explicit confirmation, verified project ownership, an exact-name 404 and a complete project sandbox listing; it preserves the original failed receipt. One real Vercel synthetic check passed with deletion confirmed on October 26, 2026. Vercel now also supports bounded native chat execution; one approved native chat calculation also passed with exact output and verified deletion on October 26, 2026. See [Vercel execution](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/VERCEL.md).

For native chats, the header shows **Sandbox off**, Docker activity, or Vercel readiness/activity and permission or recovery problems. ACP chats show their agent connection and identify execution as managed by the external agent. Provider cards distinguish unsaved, unverified, changed, passed and failed connection checks, show the check time, and separately report active work or unknown cleanup. A past passing check is not a persistent live connection. Local status refreshes every three seconds while the tab is visible; it does not poll or create provider resources.

Perplexity **SPACE** now has a self-hosted connection in **Environments**. Save your management/data-plane/console origins, published template and encrypted token, then use **Check connection** for read-only account, cluster and public M1 API verification. **Test sandbox execution** is a separately acknowledged create/command/delete check. It requires SPACE 0.8.x; local fixtures cover 0.8.0, while live server acceptance remains pending. Unknown outcomes block further creation across configuration changes and restarts. Recovery follows the original account and resource; a 404 never proves deletion. The documented Linux/KVM server runs separately from this Mac app. See [SPACE setup and recovery](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/SPACE.md) and the [source assessment](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/research/SPACE.md). SPACE does not include hosted compute or a sandbox lifetime guarantee; general agent execution remains disabled.

NVIDIA **OpenShell 0.1.6** has an optional gateway adapter in **Environments**. Install its SDK separately, save your gateway/workspace and encrypted mTLS or OIDC credentials, then check gateway health, authenticated identity and workspace access. A separately acknowledged synthetic check verifies output and deletion of the original sandbox ID. Unknown outcomes retain recovery holds; general OpenShell chat execution and live gateway acceptance remain pending. No SDK or gateway runtime is added to the core npm dependencies. See [OpenShell setup, limitations and recovery](docs/OPENSHELL.md).

Microsandbox is available as an optional Docker-free local execution add-on. In **Environments → Microsandbox**, install the pinned runtime/image, run the local check, then select it for new chats. Setup and cleanup status stay separate; unknown outcomes require recovery before more execution. Native chat execution, timeout, output bounds, cancellation and restart reconciliation passed on Apple Silicon with real local microVMs and a fixture model. See [Microsandbox setup and recovery](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/MICROSANDBOX.md).

### Current boundaries

The ChatGPT bridge supports text and function tools. It rejects missing reasoning state, changed/compacted history and unsupported output rather than continuing with incomplete context. Use a new chat with a reviewed summary when that guard stops a conversation. Live reasoning-bearing output, refresh/revocation and quota recovery still need separate account acceptance; synthetic tests cover these contracts.

Native model calls share a persisted 40-request/10-minute budget per project, connection and model, with a 10-minute turn limit. These limits are fixed in this alpha. File approval does not isolate the service from another program running as your OS user. Avoid simultaneous edits while applying an artifact; an adversarial OS process is outside this local-user threat boundary.

Start a **new chat** for subordinate agents and the current P2 tools. Earlier chats retain their original runtime identity and tool set so recovery history remains usable. Capability snapshots freeze each new turn; permission revocation is checked again at tool dispatch. This is functional Agent Zero influence, not full parity: see the [capability comparison](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/AGENT-ZERO-COMPATIBILITY.md).

Native Python plugins, arbitrary cloud agent execution, MCP OAuth/Apps, browser embeddings, automatic document ingestion, shared cross-project memory and executable third-party Slim plugins remain future work. The Agent Zero bridge is protocol-tested with a synthetic server; actual plugin behavior requires checks against the owner’s Agent Zero instance. MCP approvals do not isolate a local stdio process: it runs with the OS user’s authority. Hosted embedding revisions are user-supplied namespace labels; provider-side model changes cannot be independently pinned by this compatible API.

Subordinates have at most two levels, two active assignments per root turn, six assignments per root turn, eight model requests per assignment, two minutes (or the parent’s remaining time), and a 16,000-character returned summary. All requests consume the same connection budget. These are request/time limits, not a guaranteed token or dollar ceiling. Only the assignment is passed from the parent; children retain their own history. An interrupted child is held for inspection and explicit continuation instead of being silently recreated. Stop on a parent cancels its descendants and waits for pending child startup and cleanup. After a service crash, continuation may wait up to 40 seconds for the native runtime's local lock and terminal evidence; it sends no model requests during that cleanup. Missing evidence keeps the child interrupted.

### Using the new capabilities

1. In **Skills & MCP**, review a SKILL.md and import it disabled, then enable it for the selected project. Start a new chat and ask a task relevant to that skill.
2. For MCP, save a connection, discover its catalog, allow selected tools and enable the server. The agent stages a call; open **Approvals** to review its arguments and run it once. Send a follow-up message so the agent retrieves the result.
3. For individual Agent Zero MCP tools, enable **Settings → MCP Server** in Agent Zero. In Slim choose **Agent Zero MCP tools**, enter only the instance base URL, and put the token in its separate password field. Use HTTPS for non-loopback instances. Never paste a token-bearing MCP URL into the endpoint field.
4. In **Memory**, add notes and decide whether the agent may recall or save/delete them. Embeddings are optional. Use **Embeddings & models** to download MiniLM or add an independent hosted connection, then explicitly build the selected project’s index.

5. In a **new chat**, ask for a focused subordinate review. Open the child from **Subordinate tasks**, inspect its activity, and choose **Continue in parent** to draft a follow-up. Sending that draft is a separate action. Existing chats keep their earlier tool sets.

## Storage and development

On macOS, app data lives in `~/Library/Application Support/A0-SLIM`; elsewhere it uses `$XDG_DATA_HOME/A0-SLIM` or `~/.local/share/A0-SLIM`. Override with `A0_SLIM_DATA_DIR`. Use `A0_SLIM_PORT` to change the port. Project files remain in their selected folders. App metadata and conversation journals are local; **credentials and provider protocol journals are encrypted by the application; transcripts, artifact contents, execution output and other metadata are not**. Protect the data directory and its backups with your OS account/disk protections.

```sh
npm run check                 # typecheck, contract/integration tests, production build
npm run test:package          # fresh tarball install, CLI/UI/native runtime, optional add-on CPU probe
npm audit --audit-level=high
npm run dev                   # source server; build the UI first
npm run watch:ui              # rebuild UI in a second terminal; refresh the browser
node --import tsx tests/helpers/docker-live.ts  # optional real local-engine drill; no cloud use
```

`node --import tsx tests/helpers/ui-fixture.ts` starts an isolated browser verification harness on port 4311. It uses a temporary project and a clearly named local model fixture; no provider account is used. Its startup output supplies the test pairing code. Stop with Ctrl+C to remove its temporary data.

`node --import tsx tests/helpers/delegation-ui.ts` provides a separate disposable Markdown/subordinate browser fixture on the same port. Run only one UI harness at a time.

Schema 1 upgrades save a private SQLite backup in the data directory before applying schema 2. Back up the entire data directory and preserve its vault key for a complete recovery; a database backup alone does not include libfx session files.

The pinned libfx package receives a small, hash-checked stream-cancellation patch during `npm ci` and an idempotent check at CLI startup. Its rationale is in the [P0 record](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/verification/P0.md). A scoped override upgrades the transitive Zod version inside `@vercel/cli-config`; `npm-shrinkwrap.json` pins the graph in both the checkout and the distributed CLI. The source project's npm script approvals cover only the pinned SQLite and CBOR native dependencies.

## Project documents

- [Approved target specification](https://github.com/TerminallyLazy/A0-SLIM/blob/main/A0-SLIM-SPEC.md)
- [Decisions and delivery stages](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/DECISIONS.md)
- [Research and source audit](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/research/SOURCE-AUDIT.md)
- [Design review artifact](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/review/index.html) — retained prototype, not the running app
- [Untouched preliminary specification](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/original/A0-SLIM-SPEC.md)

A0 SLIM is an independent project, not a drop-in replacement for Agent Zero. Original brand assets and dependency attribution are recorded in [THIRD_PARTY_NOTICES.md](https://github.com/TerminallyLazy/A0-SLIM/blob/main/THIRD_PARTY_NOTICES.md).

## npm packaging and optional local embeddings

`npm pack` builds a CLI tarball containing the compiled server, prebuilt UI, attribution and a pinned optional-runtime recipe. React, icons and Markdown rendering are bundled into the UI; their build packages are development dependencies. No Transformers.js, ONNX Runtime, PyTorch, Python, model weights or personal data ship in the core runtime dependency graph. The MIT-licensed `a0-slim` package uses an explicit public release and retains the alpha version label. See [package installation and size measurements](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/PACKAGING.md).

In **Memory → Embeddings & models**, choose **Install local embeddings**, then **Download & verify** for the model. The add-on installs pinned Transformers.js and ONNX Runtime under the app's private `addons/local-embeddings` directory. PyTorch is not needed. Removing the runtime preserves downloaded models, memory and vectors; affected local semantic searches fall back to lexical search until it is reinstalled. Hosted embeddings, native chat, MCP and sandbox integrations work without the add-on. Model files live separately under `models` and are never committed.

## Develop from source

```sh
git clone https://github.com/TerminallyLazy/A0-SLIM.git
cd A0-SLIM
npm ci
npm run check
npm start
```

Use Node 24. The repository's script approvals are pinned separately from a consumer's installation. See [release verification](https://github.com/TerminallyLazy/A0-SLIM/blob/main/docs/PACKAGING.md#release-process).

## License

[MIT](https://github.com/TerminallyLazy/A0-SLIM/blob/main/LICENSE). Third-party libraries, models and brand artwork retain their own licenses and notices.

### Bash

New native chats support real Bash scripts in the selected Docker, Vercel or Microsandbox environment. Pipes, heredocs, stdin, separate stdout/stderr, exit status, timeout, cancellation and recovery receipts are included. Sandbox files last for one call; combine related steps into a script. Host Bash is disabled by default and can be enabled per project in Environments, with explicit OS account access. Start a new chat after enabling it. See [setup, limits and recovery](docs/BASH.md).

Docker Bash requires its separate pinned image. Microsandbox requires updating the optional add-on and rerunning its check. Neither adds images or a shell runtime to the core npm package. [BrowserPilot assessment](docs/research/BROWSERPILOT.md) records possible browser-workflow adaptations; no BrowserPilot code or browser automation runtime is bundled.
