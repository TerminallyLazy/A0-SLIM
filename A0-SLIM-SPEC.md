# A0 SLIM — revised build specification

**Revision 0.6 · 2026-10-26 · Local alpha; live acceptance gates remain**

Owner direction: a local-first app, public GitHub repository, flexible model and sandbox connections, useful access to the Agent Zero Plugin Hub, and a polished, minimal, customizable interface. The [preliminary spec](docs/original/A0-SLIM-SPEC.md) is preserved unchanged. The user approved the direction on 2026-10-26. This specification describes the target product; delivered behavior and open gates are recorded in [P0 verification](docs/verification/P0.md) [P1 verification](docs/verification/P1.md), and [P2 verification](docs/verification/P2.md).

## 1. Product and scope

A0 SLIM is an approachable local agent workspace for research, coding, file work, and repeatable tasks. A user chooses a project, selects a model and execution environment, asks for an outcome, and follows progress through an inspectable activity timeline and real artifacts. The agent can remember approved knowledge and delegate bounded tasks.

The product runs a Node service on the user's computer and serves its UI to a browser. Closing the tab does not stop active work; stopping the service does. Remote model services and cloud sandboxes are optional connections. Local-only work is possible when a suitable local model is configured. No local Docker installation is required for the core app.

The first release serves one trusted OS user with multiple projects. Multi-user hosting, billing, team tenancy, full Agent Zero feature parity, native desktop packaging, and an always-on remote worker are separate future projects. Browser/desktop/office automation may later arrive through adapters or an Agent Zero bridge; it is not falsely presented as impossible without Docker.

**Release promise:** useful work with visible execution boundaries, recoverable sessions, portable extensions, and a beautiful everyday interface. Installation size, startup latency, and memory use must be measured; “Slim” does not imply that optional AI weights or native dependencies are tiny.

## 2. Corrections to the preliminary design

| Preliminary assumption | Revised decision |
| --- | --- |
| “libfx v3+” | npm package is `0.0.14`; its API version is 3. Pin the package, not a nonexistent package major. |
| Node 20+ | Target Node 24 LTS. Node 20 is EOL. Verify packaged native/WASM support per platform. |
| Static prompt built once at startup | Cache immutable fragments; assemble a versioned, policy-filtered prompt snapshot per turn. |
| Every model fits the same custom provider | libfx's custom provider speaks Chat Completions. Other protocols require a tested bridge. |
| Codex provider equals recommended subscription flow | Current OpenAI documentation describes dynamic registration and public Responses. Verify integration separately from libfx's bundled Codex helper. |
| Removing Docker means running commands unsandboxed | Add execution adapters. Start with execution off or a configured sandbox; local host mode is a deliberate opt-in. |
| JSON vector file rewritten per change | Use transactional SQLite metadata/text/embeddings and a small in-process similarity search. |
| A `response` tool ends the engine loop | Use libfx's terminal result. A plain host tool has no documented `break_loop` field. |
| Two chat endpoints and a shared token are enough | Add bootstrap authentication, ownership checks, message deduplication, steering/cancel, approval and artifact APIs. |
| Browser disconnect ends work | Disconnection only detaches the viewer. Stop sends an explicit cancellation and waits for execution status. |
| Plugin Hub installation implies compatibility | Browse the real catalog; classify and verify compatibility before enabling installation. |

Evidence and links: [source audit](docs/research/SOURCE-AUDIT.md). These changes retain the original independent Node/libfx direction.

## 3. Architecture and ownership

Choose **Node 24 LTS + TypeScript**, **Fastify** for a single local API/static server, **React + Vite** for the client, and **SQLite** through a pinned supported binding. React supports complex streaming and settings states without a homegrown component framework. Vite is build-time tooling; users run one service, not a dev server. Keep a single repository/package until real ownership warrants splitting it.

```mermaid
flowchart TB
  UI[Browser workspace] --> API[Local API and authentication]
  API --> Sessions[Session coordinator and policy]
  Sessions --> Runtime[libfx runtime adapter]
  Runtime --> Models[Model connection registry]
  Runtime --> Tools[Policy checked tool registry]
  Models --> Gateway[AI Gateway and compatible APIs]
  Models --> ChatGPT[ChatGPT public Responses bridge]
  Tools --> Exec[Execution adapter]
  Exec --> Cloud[Cloud sandbox]
  Exec --> Host[Opt in local process]
  Tools --> Extensions[Skills and MCP]
  Tools --> Recall[Memory and embeddings]
  Sessions --> Journal[libfx session journal]
  Sessions --> DB[SQLite app metadata]
  Recall --> DB
```

Proposed ownership:

- `src/runtime/`: libfx construction, event normalization, session-to-agent mapping, provider protocol bridges; no UI dependencies.
- `src/providers/`: connection metadata, credentials references, catalog/capability probes, auth lifecycle. Secrets never enter browser state or prompts.
- `src/execution/`: sandbox adapters, job receipts, workspace transfer and artifact collection.
- `src/tools/`: small built-in tools calling owned services; registration is explicit and validated.
- `src/policy/`: permissions, approvals, capability filtering, budgets, resource limits.
- `src/memory/`: text records, embedding namespaces, retrieval, import/export/deletion.
- `src/extensions/`: skills, MCP, Slim manifests, Hub discovery and compatibility overlays.
- `src/storage/`: SQLite migrations, application metadata, operation receipts, backups.
- `src/server/`: local authentication and versioned API; `ui/`: workspace and settings.
- `prompts/`: original Slim instructions, profiles and protocol fragments; `tests/`: contract, integration and UI verification.

Keep libfx as the loop owner. Do not wrap it in another general agent framework. Add only the provider/execution/session coordination required by this product.

Use an OS-appropriate user data directory outside the source checkout by default; `A0_SLIM_DATA_DIR` may override it. Separate `sessions/`, `models/`, `artifacts/`, `backups/`, and the app database. Project folders are separately chosen. SQLite and the libfx journal have distinct owners; reconstruct derived UI state rather than writing a competing authoritative transcript.

## 4. Model connections and subscription access

### Independent registries

`ModelConnection`, `EmbeddingConnection`, and `ExecutionConnection` are separate records. A preset references each by ID; it does not copy secrets. A connection declares protocol, credential reference, endpoint, model catalog source, supported features, health state, and last verification time. Custom endpoints are user-configured administrator settings, never model-generated URLs.

| Connection | Planned route | Delivery |
| --- | --- | --- |
| Vercel AI Gateway | Native libfx gateway | P1 default cloud option; user can choose another. |
| ChatGPT subscription | Official Sign in with ChatGPT + public Responses integration | P0 proof; P1 release gate. |
| OpenAI API, OpenRouter, compatible providers | libfx custom Chat Completions provider | P1, per-model tool/stream tests. |
| Gemini API | Documented OpenAI-compatible endpoint | P1, validated subset. |
| Ollama / LM Studio | User's local compatible server | P1; verify selected model supports tools. |
| Anthropic API | Initially available through Gateway; direct Messages protocol bridge | Direct connection P2, explicit capability validation. |
| Hugging Face Inference Providers | Compatible hosted chat endpoint | P2; model and backend availability vary. |
| Grok subscription | libfx offers a helper; provider contract/access still needs validation | P2 opt-in experiment, not launch acceptance. |
| Additional subscriptions | Dedicated connector where vendor supports third-party use | No generic “paste your session cookie” mechanism. |

Never silently send a conversation to a different provider after failure. Fallback is configured by the user, displays the destination and billing route, and respects project data-sharing rules. A catalog lists possibilities; a completed request verifies current access. Show auth, capability, quota and outage errors separately.

### ChatGPT design and compatibility gate

The preferred new integration uses OpenAI's documented local OSS flow: stable host ID; first-time dynamic registration; state, nonce and PKCE; loopback callback; issued client ID associated with verified account/workspace; validated token identity and granted plan scope. Credentials are held by Slim, with refresh serialized per account. Do not reuse another application's rotating credential file. See [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

The inference contract uses public `POST /v1/responses`, `store:false`, `stream:true`, account-aware model choices, and explicit completion handling. Unsupported parameters and tool types must be removed/rejected rather than guessed. See [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

**Implemented bridge, bounded compatibility:** libfx 0.0.14's built-in `codex` helper uses a Codex-client flow, while its custom provider is Chat Completions. The alpha implements a narrow in-process protocol bridge through libfx's documented `fetch` seam. The bridge converts messages and function calls to the supported public Responses shape and maps streamed results back without losing call IDs, errors, cancellation or terminal status. It has an internal endpoint identity intercepted in-process, never a public proxy. Credentials attach only at the OpenAI fetch boundary.

Acceptance includes a two-step tool round trip, restart with history, account switch, token refresh, revocation and an error after streaming starts. If the bridge cannot preserve semantics, record the blocker and propose an upstream supported adapter or a separately scoped Codex app-server mode. Do not quietly replace libfx or ship a reverse-engineered endpoint as the approved path. Live ChatGPT text/function requests and an approved synthetic artifact have passed. Completed provider output, including encrypted reasoning and message phase, is retained in an encrypted account/chat/model-scoped journal before tool dispatch. Some live subscription streams carry completed items separately and leave the terminal output array empty; the bridge accepts those items only after terminal success. File-evidence notes inserted by libfx on restoration are retained separately as user context. JSON arguments are canonicalized for stable native replay. Changed or compacted history fails closed; automatic compaction and fork mapping are not implemented. Real reasoning-bearing output, refresh/revocation, quota behavior and additional models remain separate acceptance gates. See the verification records for restart evidence and limits.

Model selection in a new draft stays in the draft until first Send. Saving a preset or browsing model choices must not create a remote agent session. Freeze the effective configuration on accepted turns. Keep stable libfx agent identities per connection/profile revision; when switching providers, show the data transfer and fork into a new mapped runtime session with a deliberate context handoff. Same-provider model changes apply only to the next turn after capability checks. This avoids mutating one shared named agent's configuration underneath existing sessions.

## 5. Execution environments and adding services

The alpha offers **No code execution** or **Local Docker** for new chats, plus synthetic-only **Cloud sandbox** connection checks. The target also includes explicitly opted-in **Trusted local process** execution. Read-only chat/research remains usable without a sandbox account. A configured sandbox is the recommended environment for arbitrary code. Trusted local mode clearly states that commands have the host user's OS permissions; a working-directory check is not isolation.

The “Add environment” flow is: choose service → enter connection details → test connection → inspect supported capabilities → select region/template/network policy and limits → save → select per project. Following the owner’s free-option request, the alpha includes local Docker execution plus synthetic check adapters for Vercel Sandbox, Modal, E2B and Daytona. Each cloud card provides official logos, signup/sign-in/dashboard links and guided credential setup. Provider website authentication is separate from the encrypted application credential. The target design allows users to add a compatible service by URL/API key through the versioned Slim Runner protocol; an arbitrary vendor API still requires an adapter. Advanced users can install a reviewed adapter package. No editing application source is needed for an existing adapter.

The alpha's local Docker runner pins its Node image by digest, permits only a local Unix-socket engine, and creates one disposable container per call. It uses no network, host mounts or credentials; drops capabilities; runs non-root; limits CPU, memory, process count, output and execution time; and verifies removal. Unknown cleanup blocks new work until exact-resource reconciliation. The project default is copied into each new chat and displayed as its effective environment.

Cloud check adapters persist identity and scope before creation, keep project data local, and enforce a 60-second sandbox TTL. Vercel reconciles stop/deletion; Modal reconciles termination; E2B and Daytona verify deletion by resource ID. E2B uses a kill timeout with auto-resume disabled; Daytona uses a one-minute wall-clock TTL and automatic deletion. A Modal app/base-image cache can remain after stopped compute. A timed-out creation stays unknown even if the SDK later completes it; recovery uses the original name and ownership tags. Cloud agent execution and the general Runner protocol below remain target work.

| Option | Free-use model, checked 2026-10-26 | Alpha capability |
| --- | --- | --- |
| Local Docker | No cloud compute fee; local engine/resources required | Agent Node.js execution, real local checks passed |
| Vercel Hobby | 5 CPU hours, 420 GB-hours, 5,000 creations monthly; quota pauses | Configurable synthetic check; live account pending |
| Modal Starter | $30 monthly compute credit; additional usage may be billed | Configurable synthetic check; live account pending |
| E2B Hobby | $100 one-time usage credit; no card required to start | Configurable synthetic check; live account pending |
| Daytona | $200 introductory compute; usage pricing afterward | Configurable synthetic check; US region; live account pending |

```typescript
// Proposed Slim contract, not an existing vendor API.
interface ExecutionAdapter {
  id: string;
  capabilities: ExecutionCapabilities;
  testConnection(signal: AbortSignal): Promise<ConnectionReport>;
  create(spec: SandboxSpec, operationId: string): Promise<EnvironmentRef>;
  inspect(ref: EnvironmentRef): Promise<EnvironmentState>;
  execute(ref: EnvironmentRef, job: JobSpec): AsyncIterable<JobEvent>;
  cancel(ref: EnvironmentRef, jobId: string): Promise<CancelReceipt>;
  upload(ref: EnvironmentRef, files: WorkspaceManifest): Promise<TransferReceipt>;
  download(ref: EnvironmentRef, paths: string[]): Promise<ArtifactManifest>;
  stop(ref: EnvironmentRef): Promise<StopReceipt>;
  destroy(ref: EnvironmentRef): Promise<void>;
}
```

Optional capabilities include pause/resume, snapshots, PTY, network allowlists, persistent disks and resource telemetry. Advertise only features the service actually supports. Unsupported policy requirements fail before creating an environment. Vercel snapshot behavior and E2B pause semantics differ; the UI must not call both “Save” without explaining the result. Pin the chosen SDK/API generation; Daytona's stable and alpha docs describe different lifecycle contracts.

Each job carries an operation ID, environment ID, working directory, timeout, output cap and cancellation signal. Persist creation and command receipts; on timeout or host restart, reconcile with the provider before repeating a potentially mutating operation. `unknown` is a real outcome. No automatic fallback from a failed remote sandbox to unrestricted local execution.

Transfer only selected project paths with a displayed upload manifest; exclude credentials and private app data. Collect output into quarantined artifact staging, validate paths/size, preview diffs, then apply approved changes to the local workspace. Remote sandbox isolation does not protect data intentionally uploaded to it. The sandbox receives no model keys by default; any command-specific secret grant is scoped and redacted.

Start with conservative, editable limits: 10-minute job timeout, 1 MiB retained inline output, 100 MiB transfer allowance, one active environment per project. Treat these as product defaults, not vendor quotas. Show TTL, status and estimated/actual resource usage when available; never fabricate a dollar figure for a subscription or unavailable sandbox cost.

## 6. Tools, policy and prompt construction

Expose only enabled tools that the current project, model and execution environment can actually use. Generate the tool catalog from the same registry that dispatches calls. Validate names and JSON schemas at startup. Tool outputs, web pages, repository text, memory and plugin metadata are untrusted content, not permission to change policy.

| Tool | Replay classification | Design |
| --- | --- | --- |
| `read_file`, `list_dir` | `idempotent:true`, `writes:false` | Authorized project root, bounded output, safe path handling. |
| `write_file` | `true,true` for staging only | Immutable, deduplicated proposal; exact browser approval performs atomic application. Unknown outcomes block new proposals until reconciliation. |
| `apply_patch` | Planned | Must use the same reviewed-operation boundary. |
| `run_javascript` | `true,true` with owned receipt | Disposable local Docker computation; repeated call IDs reuse receipts, unknown cleanup blocks further execution. |
| `code_execution` | `false,true` | Execution adapter only; shell semantics explicit; no automatic retry of unknown effects. |
| `web_search` | `true,false` for ordinary lookup | Configured search connector; citations returned as data. Gateway provider search is capability-specific. |
| `memory_save`, `memory_delete` | `true,true` only with atomic operation-key deduplication | Transaction includes mutation and receipt; otherwise classify non-idempotent. |
| `memory_load` | `true,false` | Project isolation and provenance filters. |
| `call_subordinate` | `false,true` until durable child deduplication is proven | Creates work and consumes budget; cannot broaden permissions. |
| `wait`, `notify_user` | Explicit bounded semantics | Local UI events only; external messaging is a separate permissioned extension. |

`writes` controls libfx scheduling; it does not grant OS permissions. `idempotent` is a recovery promise, not a synonym for “read-only.” A SIGKILL proof against libfx 0.0.14 showed that an ambiguous non-idempotent call becomes an error result, after which the model can issue another call. Slim must block effectful tools until unknown operations are reconciled; an error message to the model is insufficient. The foundation therefore exposes only read-only file tools. Built-in serialization does not prevent conflicts between separate sessions; Slim owns project/resource locks and file revision checks. The source package documents native parallel calls and different WASM scheduling. See [libfx tools](https://fx.sh/docs/lib/tools).

Return the final answer through the engine's terminal event, not a fictitious tool return flag. Preserve the familiar Agent Zero tool vocabulary where useful, but write Slim-specific prompts for native structured tool calls. Assemble role → project/profile → capabilities/tool catalog → activated skill summaries → response/safety protocol. Freeze fragment hashes, plugin versions and the effective policy on each accepted turn; refresh on the next turn when settings change.

Subordinates inherit a subset of tools, the remaining parent budget, the same project boundary and cancellation tree. Default maximum depth 2, two active children, bounded token/step/time budgets. Store parent-call-to-child-session mapping before starting work. After interruption, reconnect to that child rather than spawning another. Never pass arbitrary entire parent history or credentials by default.

## 7. Local memory and Hugging Face

Memory is optional and inspectable. Save deliberate user requests and useful, attributable task results; do not silently turn every conversation into permanent memory. Project-specific storage is the default, with explicitly shared notes available across chosen projects. Keep `main`, `fragments` and `solutions` as familiar area labels, without promising byte compatibility with Agent Zero FAISS indexes.

SQLite stores IDs, project scope, text, source references, created/updated timestamps, area, tombstone/deletion status, schema version and operation receipts. Store embeddings separately with a fingerprint of provider, model/revision, dimension, normalization and preprocessing. Mixing incompatible vectors is forbidden. Changing embedding models starts a resumable reindex into a new namespace and switches atomically after validation; lexical retrieval remains available during migration.

Start with FTS lexical retrieval plus brute-force cosine ranking for small corpora, combined by rank fusion. Expose relevance scores as ranking aids rather than calibrated probabilities. Benchmark 10,000 records on documented hardware before selecting an approximate index. A vector database service is unnecessary for this initial scale.

| Embedding mode | Benefits | Requirements |
| --- | --- | --- |
| Local Node + Transformers.js | On-device embeddings; durable disk cache | Explicit model download, pinned revision/checksum, license/size display, worker thread. Recommended optional local mode. |
| Browser worker + Transformers.js | Private browser-side ingestion/experiments | WASM/WebGPU detection, quota/eviction handling, re-download recovery. P2 experiment, not the server's durable memory owner. |
| Gateway/OpenAI/compatible embedding API | Small local installation | Separate key/account and data-sharing choice; batching and rate limits. |
| Hugging Face hosted inference | Additional hosted embedding choices | Verify feature-extraction output/pooling and model availability. Hosted inference is distinct from downloading weights. |

Hugging Face supplies model artifacts; local execution requires an appropriate runtime and format. Transformers.js can load ONNX models and local files. GGUF chat models belong to compatible runtimes such as Ollama/llama.cpp/LM Studio, not automatically to Transformers.js. [Custom model loading](https://huggingface.co/docs/transformers.js/custom_usage).

The model manager must support progress, cancel/resume where supported, storage location, disk estimate, offline-ready verification, and delete. Do not download weights on first launch without a user action. Bundle/pin required WASM assets for a real offline mode; a cached model alone is insufficient if runtime assets still come from a CDN. Browser caches can be evicted, and browser closure cannot own background recall.

Deletion removes active text, vectors and derived search entries; tell the user what retained backups contain and provide backup deletion. Export memory with provenance and schema version; import text independently from incompatible embeddings. Memory retrieval never grants permission to run a tool.

## 8. Plugin Hub, skills and MCP

The real Agent Zero community index is discovery metadata pointing to separate plugin repositories. The current app consumes the generated release JSON at `https://github.com/agent0ai/a0-plugins/releases/download/generated-index/index.json`; individual upstream `index.yaml` files are not a single root catalog. Current plugins may contain Python hooks, framework imports, Alpine UI fragments and OS dependencies. This is not a Node package registry. Use a read-only Hub catalog and an independent Slim compatibility overlay; do not invent supported fields in upstream `index.yaml`. [Upstream index](https://github.com/agent0ai/a0-plugins).

Show **Works with Slim**, **Requires Agent Zero**, **Port available**, or **Compatibility unknown**, with a reason and last verified revision. A familiar name or valid manifest is not sufficient evidence. Preserve the last good catalog on fetch failure, show its age, allow explicit refresh, and prevent an older request from overwriting newer results.

Four extension routes:

1. **Skills:** Markdown instructions and opt-in resources. Scripts still run through the selected execution adapter. Skill loading does not bypass permissions.
2. **MCP tools:** supported through libfx's adapter, with configured transports, server identity, authentication, timeouts and health. Treat remote annotations as hints; writes are conservative by default. A local stdio server is executable host code, so starting it is an installation capability, not just loading metadata.
3. **Slim extensions:** versioned `a0-slim.plugin.json` with ID, version, runtime API range, entry point, settings schema, contributions and permissions. Contributions initially include providers, embedding backends, execution adapters, tools, skills and theme tokens. Trusted built-in adapters may run in-process; third-party executable extensions need an isolated runner or an explicit full-trust installation choice. A Node worker process alone is not a security sandbox.
4. **Agent Zero bridge:** optional connection to an existing Agent Zero instance, exposing supported remote operations. Python plugin behavior stays on Agent Zero. This does not make its WebUI fragments or arbitrary API handlers native Slim components. Bridge compatibility is a separately tested P2/later surface.

Install flow: source and revision → compatibility → permissions and dependency summary → download/validate → stage → explicit enable → health check → rollback on failure. No executing installation hooks while browsing. Updates pin a resolved revision, show new permissions, and retain the previous working version. Disable/uninstall cancels owned work and offers keep/delete plugin-owned data. Unknown/incompatible plugins offer “View source” or bridge guidance instead of a misleading Install button.

Avoid arbitrary UI JavaScript injection into the main origin. Start with declarative settings and theme contributions. Rich third-party screens later need a separate-origin/sandboxed surface and narrow message protocol. MCP Apps/Generative UI compatibility is not implied by basic MCP tool support.

## 9. Sessions, streaming and local access

Use `createFxAgent` for durable sessions and `createFxEngine` only for bounded experiments/tests. Pin `libfx@0.0.14` and lock transitive dependencies. Persist with explicit `local({dir})`; do not accept libfx's temporary-directory default. Respect SDK-generated session IDs rather than constructing arbitrary IDs. Maintain the application chat ID → runtime session mapping in SQLite.

A user message has a stable client-generated `messageId`. Retry submits the same ID, and an accepted input remains accepted even if the HTTP stream breaks. The canonical UI stream uses `session.stream(cursor)`; persist the last *applied* cursor. Avoid independently rendering both a prompt stream and a replay stream as authoritative copies. Normalize NDJSON into a versioned Slim event envelope with session/turn/tool IDs, cursor and timestamps. Do not parse provider raw events in UI components.

Required API families under `/api/v1`:

- bootstrap/login/logout and server status;
- project/chat creation, listing, metadata and archive;
- messages, event stream, steer and cancel;
- durable approvals with action hash and policy revision;
- files, artifact manifests, diff/apply and download;
- connections, auth lifecycle, model catalogs and health;
- memory, model downloads, extensions and appearance settings.

Only the coordinator opens authorized runtime sessions. Every read, stream, prompt, steering, cancel, file and artifact request checks the caller's access. Loopback binding, strict Host/Origin checks and CSRF protections are required; an unrelated website must not command the local service. Use a one-time pairing code displayed by the launcher, exchanged for an HttpOnly SameSite session cookie, not a permanent token in localStorage or URL history. API clients may use a separate scoped token. Production remote exposure is off by default and not supported in the initial release.

Stream errors distinguish rejected input, interrupted viewer, failed model, pending approval, lost execution status and cancelled run. A stop request is visible immediately, but the UI reports completion only after children and commands stop or their unresolved status is shown. Service shutdown stops accepting work, flushes journals and attempts cleanup; restart reconciles environment receipts and interrupted turns.

## 10. Workspace experience and visual direction

**Direction: a functional Agent Zero workspace.** Graphite surfaces, warm neutral text, restrained green/teal accents, thin dividers and purposeful typography. Use original Agent Zero symbols from `docs/res/a0-vector-graphics/`, copied unchanged with attribution; pair them with the A0 SLIM name. Do not invent a replacement logo or imply upstream endorsement.

The primary screen is the workspace, not a marketing landing page: collapsible project/chat navigation on the left, conversation and composer in the center, optional inspector for Activity / Files / Memory on the right. Use generous reading space without wasting operational space. Use plain page titles and descriptive controls; do not use eyebrow labels or slogan-style copy. Activity appears as compact meaningful steps; expand raw logs on demand. Outputs have previews, provenance and download/apply actions.

The composer includes model and execution selectors plus attachment and Send/Stop controls. Persistent status makes the active environment visible. The user should never need to open Settings to know where a command will run. A command palette helps keyboard users navigate without adding toolbar clutter.

Appearance controls: System/Graphite/Paper, approved accent choices, comfortable/compact density, text scale, content width, inspector visibility and reduced motion. Store preferences separately from chat data; export/import a validated theme JSON. Custom CSS and executable theme scripts are out of scope initially. Enforce readable contrast rather than allowing unusable color combinations.

Responsive behavior: at wide widths show three panes; collapse the inspector below roughly 1100 px; at narrow widths use drawers and a full-width conversation. Test 1440×900, 1024×768 and 390×844. Keyboard focus, screen-reader labels, 44 px touch targets where practical, visible focus, AA contrast and reduced-motion support are acceptance criteria. Motion is brief and explains progress or pane changes; no decorative perpetual animation.

| State | Visible feedback | Next action |
| --- | --- | --- |
| Empty | Useful starting prompt, chosen model/environment | Create/open project or start chat. |
| Loading | Stable layout, truthful stage, cancel where possible | Wait, stop or inspect progress. |
| Permission | Exact action, destination, files and scope | Allow once, narrowly allow for session, deny. |
| Partial | Available output plus missing/failed portion | Retry only the safe unfinished part. |
| Error | Specific cause and retained draft/output | Reconnect, reauthenticate, change configuration or inspect. |
| Success | Actual artifact/result and location | Preview, apply, download or continue. |
| Recovery | Interrupted tool and known/unknown effect | Inspect external status before retrying. |

The accompanying [interactive preview](docs/review/index.html) uses fictional project content. Its theme, density, navigation and inspection controls demonstrate design intent; its providers and task results are not connected runtime features.

## 11. Security, reliability and distribution

Store API/OAuth credentials using the OS credential store where available; use an explicitly configured encrypted vault otherwise. Keep encryption keys outside the vault. Do not silently downgrade to plaintext if secure storage is unavailable. Restrict data-directory permissions; redact tokens and sensitive tool values in diagnostics. Local session files and SQLite content are not claimed to be encrypted at rest unless implemented; OS disk protection remains relevant.

Constrain direct file tools by canonical root, symlink rules, parent checks for creation, resource limits and expected file revisions. Test symlink escapes and replacement races. These checks guard file tools, not arbitrary host shell code. Sandbox/provider URLs reject embedded credentials and unsafe redirects; configured local endpoints are explicitly distinguished from public endpoints to avoid accidental SSRF. Sanitize rendered Markdown and never execute generated HTML in the application's privileged origin.

Persist approvals bound to an immutable action digest, session/turn, destination and permission scope. A changed action needs a new authorization. A restarted process must not reuse an approval for a different command. Limit total model turns, wall time, child fan-out and sandbox resource use. Show the source of any stop limit.

Distribute an npm CLI that serves a prebuilt UI and prints the actual loopback URL. No install-time downloads of model weights. First support macOS arm64 and Linux x64; gate Windows and other architectures on real libfx backend smoke tests, particularly WASM/JSPI behavior. No claim of full portability from a TypeScript build alone.

Use backup-before-migration for user data, versioned schema migrations and a documented downgrade boundary for libfx journals. Keep export/import usable without the original model service. Telemetry is off by default; opt-in diagnostics show exactly what will be exported. No cloud deployment, vendor signup, paid resource or public package publication is authorized merely by approving this spec.

## 12. Delivery gates and validation

### P0 — prove the foundations before building breadth

- Verify native libfx startup on Node 24 on the chosen platform, custom provider tool-call semantics, generated IDs and durable local restart. Add focused test fixtures for every assumption used by the adapter.
- Prove the preferred ChatGPT flow and public Responses bridge with a user-authorized real account. Require terminal success, not an open authorization page. Synthetic tests are separate evidence.
- Prove Vercel Sandbox lifecycle, timeout, command receipt, artifact round trip and cleanup against a configured account; retain an adapter contract fixture for offline CI.
- Decide SQLite binding and keychain support from installation tests; record package pins and platform requirements. Retain existing logo provenance.
- Stop the affected feature if a critical API assumption fails; revise the decision rather than silently changing the product architecture.

### P1 — usable local alpha

Deliver first-run connection setup, projects/chats, Gateway/compatible models, the validated ChatGPT route, one sandbox adapter, safe built-in tools, draft model selection, streaming/replay, stop/steer, file/artifact workflow, approvals and appearance. The app must be useful without semantic memory or third-party plugins.

Acceptance: one end-to-end task generates an artifact; the UI reconnects without duplicate messages; an interrupted mutation is reconciled; the model/environment are always apparent; auth/CSRF and project-file escape tests pass. Capture rendered evidence at all target sizes.

### P2 — extensibility and memory beta

**Delivered P2 preview (2026-10-26):** native skill loading; turn-scoped capability snapshots; opt-in automatic lexical recall and atomic memory tools; MCP Streamable HTTP and full-trust stdio discovery with tool grants and exact-call approval/recovery; an Agent Zero MCP bridge preset with encrypted token custody; real Hub discovery and pinned source assessment; SQLite/FTS5 project memory; local pinned MiniLM downloads and isolated CPU inference; separate compatible embedding connections; resumable reindexing and hybrid retrieval. See the delivery record for evidence. The bridge still needs an owner-run instance check, and this does not close all P2 acceptance gates.

The real Vercel synthetic sandbox check subsequently passed with artifact bytes, stop and deletion verified. Team slugs resolve through authenticated project metadata, public connection IDs persist in setup, and explicit provider-review reconciliation handles an absent earlier resource without erasing its failed receipt. General cloud execution and second-provider conformance remain open.

Current preview boundaries: text-only skill import, one revision of rollback, manual MCP approvals followed by a new user message, no MCP OAuth/Apps, no native plugin installation, no shared memory, no document ingestion, no browser embedding worker, no subordinate agent tool. New chats use the P2 runtime identity; existing chats keep their original tool set. Downloads resume completed checksum-verified files, not partial byte ranges. Hosted model revision labels partition indexes but cannot guarantee provider-side weight immutability. Optional inference libraries remain part of the source installation footprint.

Deliver SQLite memory with lexical and optional local embeddings, model download management, bounded subordinates, MCP/skills, compatibility-aware Plugin Hub, and validated cloud agent execution on the existing sandbox adapters. Prototype the Agent Zero bridge and direct Anthropic adapter behind documented capability gates.

Acceptance: the same execution conformance suite passes for two services; reindexing never mixes vector spaces; a plugin can be disabled/rolled back without orphaned jobs; unknown Python plugins are never installed as native Node extensions. Prove one real compatible extension and one deliberately incompatible entry. Browser embeddings are experimental until eviction/offline tests pass.

### P3 — public release

Ship installation/update/uninstall docs, configuration examples without secrets, provenance/notices, migration/backup guides, troubleshooting, security-reporting process and a versioned changelog. Run focused unit/contract tests, integration tests for touched boundaries, then the release end-to-end suite. Publish only after the user authorizes the release action.

Critical verification cases: duplicate message ID; UTF-8/NDJSON chunk boundaries; stale cursor; interrupted tool; unknown remote effect; crash during memory write; embedding model mismatch; child cancellation; token refresh concurrency; post-stream quota error; malicious Markdown; unauthorized stream/cancel; symlink escape; Hub stale-response race; plugin uninstall cleanup; secret-free export.

Performance targets, to be measured on named hardware: warm UI interactive within 2 seconds, ordinary local API p95 below 100 ms excluding model/disk-heavy work, transcript scrolling responsive with 1,000 messages, and retrieval p95 below 150 ms for 10,000 records excluding embedding generation. Targets are acceptance budgets, not measured results. Keep optional ML loading off the server event loop.

## 13. Review decision

Approval selects this local-first architecture, the visual direction, and the staged validation plan. It authorizes beginning P0 and then implementation within the validated scope. External account login, paid infrastructure, a change to a fundamentally different runtime, and public package release remain explicit actions when concretely ready.

Open technical gates are ChatGPT/libfx protocol compatibility, actual sandbox account capabilities, cross-platform packaging and per-plugin compatibility. They are intentionally visible; none has been passed by writing this document.
