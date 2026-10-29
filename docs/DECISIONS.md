# Decisions and delivery stages

Approved by the user in chat on 2026-10-26. The canvas review is closed.

## One-command installation — 2026-10-26

- Add a standalone shell installer, served from the public repository, that installs the published alpha and launches its browser workspace. Keep the npm package and runtime behavior unchanged.
- Reuse compatible Node/npm or bootstrap an isolated, hash-pinned official Node 24 distribution. Keep install state separate from app data and avoid sudo, shell-profile changes, npm credential inheritance and global runtime replacement.
- Verify downloads and native readiness before atomically switching the active release. Preserve working releases on failed setup, exclude concurrent installers and reuse healthy installations. Keep the foreground process cancellable and the pairing code in the terminal.
- Validate actual fresh installation with and without Node on PATH on the supported macOS/Linux targets; optional model and sandbox runtimes remain separate actions.

## First public npm release — 2026-10-26

- The user requested npm publication and selected MIT. Release `a0-slim@0.1.0-alpha.1` publicly; use the `latest` tag for the first installable release while clearly retaining the alpha label and existing capability limits.
- This supersedes the earlier packaging-only `private: true` hold. Keep optional embedding/Microsandbox runtimes out of the core graph and preserve third-party license notices.
- Publish a tested tarball from a clean committed source tree, excluding unrelated local UI edits. Verify the public registry integrity and a fresh global installation with narrowly pinned native-script approvals before reporting availability.

## Lean npm packaging — 2026-10-26

- Ship a compiled CLI and prebuilt UI with an explicit file allowlist and published shrinkwrap. Keep `private: true` until public npm release details are settled; no registry publication is part of this change.
- Move React, icons and Markdown build packages to development dependencies, retaining bundled functionality and generated license texts. Preserve the exact libfx cancellation patch, resolve it under npm hoisting and check it idempotently at CLI startup.
- Remove Transformers.js/ONNX from the core graph. Install their pinned graph through an explicit local-runtime action; ordinary npm `optionalDependencies` would still install by default. PyTorch is unnecessary.
- Stage installs in private storage with scripts disabled. Probe CPU readiness in a separate process before activation: worker termination during native initialization was observed to abort the host. Preserve weights, notes, vectors and lexical fallback through cancellation, interrupted installs, removal and reinstall.
- Keep model download consent separate. Native chat, ACP, MCP, sandboxes, lexical memory and hosted embeddings remain independent. See `PACKAGING.md` for measurements and verification.

| Decision | State | Rationale |
| --- | --- | --- |
| Product name: A0 SLIM | User requested | Consistent user-facing identity; repository `A0-SLIM`. |
| Local-first browser app and public repository | User confirmed | Local files and control, optional cloud services. |
| Preserve preliminary spec | Complete | Immutable original; revised specification is separate. |
| Node 24 LTS, TypeScript, Fastify, React/Vite, SQLite | Approved direction | Supported runtime and a maintainable interactive UI without a desktop shell dependency. |
| libfx 0.0.14 with narrow runtime adapter | Approved direction | Verified package API; pin pre-1.0 dependency and prove restart behavior. |
| ChatGPT via documented Sign in with ChatGPT | Approved, compatibility gate open | Bundled libfx Codex auth is not the same integration. |
| Local Docker, Vercel, then Modal; E2B/Daytona later | Owner requested free options | Local Docker supports execution without cloud fees; Modal adds recurring credit. Cloud adapters retain separate live acceptance gates. |
| Host execution is explicit opt-in | Approved direction | Docker-free need not mean unrestricted execution by default. |
| Local embeddings optional; lexical recall works first | Approved direction | Fast installation without downloading model weights automatically. |
| Plugin Hub discovery + explicit compatibility overlay | Approved direction | Existing Python/Alpine plugins do not execute natively in Node. |
| Twelve themes, custom colors, three-pane workspace | Delivered alpha.3 | Dark/light preview, Save/Reset, readable colors, customizable density and inspection. |

## Delivery sequence

1. **P0 — compatibility proofs:** libfx lifecycle, ChatGPT public flow, one cloud sandbox, logo provenance, distribution platforms.
2. **P1 — usable local alpha:** onboarding, providers, project chats, streamed activity, files, approvals, stop/recovery, appearance, one sandbox.
3. **P2 — beta capabilities:** durable memory, local model downloads, bounded delegation, MCP/skills, Plugin Hub compatibility, second sandbox.
4. **P3 — release:** migration/backup, security and restart drills, accessibility/performance, public documentation and versioned release.

Every stage has acceptance gates in the spec. Canvas approval starts P0; approval is not proof that those technical gates have passed. No timeline estimates are commitments.

## Foundation findings

The local service, browser UI, read-only project tools, connection vault and synthetic provider/sandbox harnesses are implemented. [P0 verification](verification/P0.md) distinguishes passing local checks from the remaining live-account, reasoning-replay, effect-reconciliation and distribution gates. This is not P1 completion.

The libfx stream initialization/cancel race receives a small checked installation patch. A separate SIGKILL proof showed that non-idempotent tool metadata does not stop a model from requesting an ambiguous effect again. The alpha now adds an owned reconciliation gate for reviewed file application and local Docker execution; the upstream limitation test remains as evidence of why it is necessary.

## Alpha 0.1.0-alpha.1 decisions

- Keep libfx as the runtime and the official public Responses bridge for ChatGPT. Retain full completed output in the encrypted local vault, including encrypted reasoning and assistant phase. Never dispatch incomplete tool calls.
- Preserve native restoration's file-evidence notes separately from the original provider history, at user-message priority. Canonicalize JSON arguments/results for stable matching; refuse unmatched or compacted history.
- Split proposal from effect: a model stages immutable text; the paired browser approves the exact digest. Persist intent before disk changes and reconcile unknown outcomes against actual bytes. Replayed/new call IDs cannot bypass the project block.
- Freeze the selected execution environment in each chat. Local Docker is optional and has fixed conservative limits; unrestricted host shell stays unavailable.
- Persist a shared model-request budget and impose a turn deadline. SQLite schema 2 keeps a pre-migration backup.
- Add Modal 0.11.1 as a synthetic cloud check. Source inspection found its declared endpoint option does not control transport in this version; reject inherited nonofficial endpoints before authenticated RPCs. Bound SDK calls independently and retain unknown creation receipts.
- Show current free allowances and differentiate trials. No account plan, unused credit or zero-dollar cloud cost is inferred from a catalog entry.

[P1 verification](verification/P1.md) is the current delivery record. Cloud checks, broad provider/model coverage, compaction and distribution acceptance are not closed by this checkpoint.


## Additional sandbox connections — 2026-10-26

- Add official `e2b@2.59.0` and `@daytonaio/sdk@0.226.1` adapters for synthetic create/execute/cleanup checks, with a shared durable receipt coordinator. Agent execution remains a separate acceptance gate.
- E2B uses explicit API credentials, the official endpoint, zero API retries, denied outbound/public traffic, no mounts, a bounded kill timeout (now configurable; see the 2026-10-29 decision) and no auto-resume. Recover by exact receipt metadata, without connecting/resuming. An empty result after lost creation remains unknown.
- Daytona uses explicit API credentials and endpoint, US region, private preview, denied outbound network, no volumes/secrets, a bounded lifetime and automatic deletion (now configurable; see the 2026-10-29 decision). SDK state polling avoids an unnecessary persistent WebSocket. Version 0.226.1 reads tracing flags from the environment even when disabled in options; synchronous construction forces these two flags off and restores their prior values immediately.
- Keep signup/sign-in on official provider websites. A0 SLIM stores API credentials locally; it does not claim delegated OAuth login or read provider CLI credential files for these new integrations. Label monthly allowances separately from introductory credits.
- Vendor unchanged official brand artwork with source URLs and SHA-256 hashes; use local assets so rendering provider cards makes no third-party image request.

## P2 extension and memory preview — 2026-10-26

- Preserve Agent Zero behavior through native tool use, just-in-time skills, project recall, attributable memory writes and remote MCP capabilities. Track differences explicitly in `AGENT-ZERO-COMPATIBILITY.md`.
- Create new chats with the `extensions-v1` runtime identity. Preserve earlier identities and provider replay journals. Freeze skills, tool schema hashes and memory permissions per turn; recheck revocation at execution. No extension code is loaded in the main UI origin.
- Use official MCP SDK 1.32.2 and libfx's adapter under a host-owned approval ledger. Save intent before the external call; never automatically retry unknown effects. Local stdio requires explicit full trust and runs outside any sandbox. MCP server hints are not permission or idempotency guarantees.
- Reuse Agent Zero's built-in HTTP MCP server for the bridge preview. Keep base URL and token separate, encrypt the latter, and construct its required token-bearing route only in transport. No framework installation or generic Python execution in Slim.
- Consume the actual generated Plugin Hub release JSON. Require a pinned commit for source assessment, preserve the last good catalog, and reject stale refresh results. Import only reviewed Markdown skills; do not download repository archives or run hooks.
- SQLite schema 3 adds transactional memories/FTS/vectors/receipts and extension records, preserving a private pre-migration backup. Memory deletion removes active rows/vectors but does not erase old chats, exported files, OS backups or migration backups. Expose backup deletion explicitly.
- Pin MiniLM model revision and every file checksum. Explicit download, file-level resume, verification and deletion; CPU inference in a worker with network fetch disabled. Separate hosted embedding keys and consent from chat providers. Switch model namespaces only after all vectors and the source generation validate.
- Do not call the source distribution tiny: the optional inference worker's runtime dependencies occupy roughly 441 MiB in this macOS checkout. This initial footprint is superseded by the lean npm packaging decision below.
- Use plain page names, useful descriptions and no eyebrow labels or slogan-style copy, per the owner's correction.

## Vercel setup and recovery — 2026-10-26

- Preserve public Team/Project IDs in the setup form while retaining write-only token custody. A blank token in an update keeps the saved token.
- Accept a team slug or ID, but verify the exact project through Vercel's documented team-scoped project lookup before any resource creation. Use the returned canonical account ID for Sandbox SDK calls. Project-scoped tokens must not require team-management permissions.
- A preflight failure creates no ambiguous resource intent. After dispatch, preserve unknown outcomes, block SDK create retries and retain the recovery hold. An explicit operator review can resolve absence only after the original lifetime, authenticated original-scope verification, exact-name 404 and complete project listing. Preserve the original outcome and review evidence; never label this as confirmed deletion or a passing check.
- Live owner-authorized Vercel proof passed through the app, including artifact verification, confirmed stop, deletion and subsequent exact-name 404. This proves the synthetic path, not general cloud agent execution or the second-service conformance gate.


## Subordinate research and visible runtime state — 2026-10-26

- Add a new delegation runtime identity only for new chats. Retain old identities and journals. Children reuse the selected project/model account while their tools and snapshots restrict authority to research/review; no credential text or full parent transcript is passed as task input.
- Reuse the Agent Zero `call_subordinate` / `context_id` vocabulary, with durable child ownership and explicit limits. Save intent before starting, preserve interrupted children, and close an abandoned child turn before explicit continuation. Parent cancellation reaches descendants; child results remain evidence for the parent to check.
- Render assistant Markdown through a React AST with raw HTML disabled and safe URLs. External images remain click-through links. Keep user/tool text literal.
- Show historical connection verification separately from sandbox activity. Credential changes invalidate verification; a saved credential is never presented as successful connection evidence. The chat header exposes its actual execution selection, including Sandbox off.

## Subordinate stop and crash recovery — 2026-10-26

- Treat native cancellation acknowledgment as queued input, not proof of a completed stop. Abort descendants immediately, track submissions awaiting session creation, and keep Stop pending until tracked work settles. Hold new turns while cancellation is in progress.
- Before continuing an interrupted child, block its model transport and follow the previous message's exact terminal event. Keep the last submitted child message ID independently of attempted continuation receipts. Unknown cleanup remains interrupted even when the user also requested Stop.
- Allow up to 40 seconds, bounded by the assignment deadline, for recovery. The pinned local backend uses a 30-second stale in-band write lock and retries acquisition for up to 35 seconds. Do not delete native locks or rewrite its journal to force continuation.
- Reject new grandchildren from child assignments that are no longer running. Preserve completed duplicate-call receipts and existing runtime identities.

## ACP external agents — 2026-10-26

- Follow the owner's approved ACP direction. Keep libfx as SLIM's native runtime and MCP as its tool protocol; route explicitly selected whole-agent chats through a separate ACP client.
- Pin the official SDK 2.0.2, stable ACP v1, stdio. Agent Zero is the first preset, using its existing A0 CLI connector with its own authentication and runtime. No custom Python bridge or native plugin loader is introduced.
- Retain the Agent Zero MCP preset for individual tools. Rename UI guidance so it no longer implies MCP is required for whole-agent access.
- Expose full host trust explicitly. Agent Zero's connector controls host writes/commands through its own configuration and may not use client permission callbacks. SLIM's optional safe read callback and absent terminal capability are not a sandbox claim.
- Preserve prompt intent, exact session identity, one-time permission decisions and unknown outcomes. Never resend on viewer reconnect or recover an ambiguous prompt automatically. Hold all new ACP work until external review, including duplicate connection profiles. Never use Agent Zero session/close for cleanup because it removes its chat.
- Scope initial support to text sessions, tool/plan updates, client read requests and permissions. Agent-specific auth, model/mode controls, attachments, MCP forwarding and HTTP transport remain explicit later capabilities. Live task evidence and second-agent conformance remain separate from fixture coverage.

## Perplexity SPACE research — 2026-10-26

- Classify SPACE as self-hosted execution infrastructure, separate from ACP and model connections. Research baseline: 0.8.0, source `dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1`.
- Prefer its native HTTP/SSE API and a dedicated operation-aware receipt journal. Do not assume the E2B JavaScript SDK conforms to SPACE's Python-tested compatibility wrapper, and do not reuse a generic 404-as-deletion cleanup contract.
- Keep server provisioning separate from SLIM installation. The documented Linux/KVM setup cannot run directly on this Mac. Capture an owner-selected deployment, supported API schema/template and private authentication before live acceptance. No infrastructure or sandbox was created by the research.
- Record the implementation sequence and capability limits in `docs/research/SPACE.md`. Adding the selectable provider and its official logo is subsequent adapter implementation, not a claimed result of this assessment.

## SPACE connection implementation — 2026-10-26

- Follow the owner's request for setup, status and recovery. Deliver a separate native HTTP/SSE adapter and self-hosted environment card, leaving native libfx, MCP and ACP behavior intact. No Linux deployment or cloud resources are provisioned.
- Use write-only encrypted management credentials, explicit management/data-plane/console origins and a declared template/runtime/resource request. Verify SPACE 0.8.x M1 schema and the 0.8.0 auxiliary auth identity contract before mutation. Token renewal must preserve verified account, organization, cluster and original endpoints.
- Separate read-only connection evidence from resource activity and synthetic execution. Background checks persist create/command/delete intents; no mutation is retried automatically. Lost create responses use exact owned-resource discovery; delete retries reuse the original key/body within 24 hours. Keep a provider-wide hold for unknown cleanup across restart or changed settings.
- Require complete bounded output and a matching zero-exit process event. A successful matching delete operation is the cleanup proof; 404 is not. Operator review records reviewed absence without rewriting the failed result and requires at least 24 hours, complete listing and terminal known creation operations.
- Do not claim stable native file transfer, a hard sandbox TTL, egress denial, general agent execution, free hosting or live server acceptance. Keep those limitations in setup and the resource acknowledgment.


## Vercel native execution without Docker — 2026-10-26

- The owner clarified that a cloud sandbox must not require local Docker. Add Vercel to the native execution selector, independent of Docker availability, while preserving native runtime, MCP and ACP boundaries.
- Scope this adapter to bounded Node.js calls with explicit code/stdin input and reviewed local artifacts. Use one nonpersistent sandbox per call, denied egress, fixed time/output/usage limits, and a revision-bound project usage grant. Existing chats keep their environment.
- Share one lease across credentials, synthetic checks, execution and cleanup. Preserve intent before network mutations; suppress repeated calls by owning turn and input digest. Block SDK creation/command retries and automatic resume, including the SDK’s GET resume route. Retain unknown outcomes and exact-resource recovery; cancellation must not skip cleanup.
- A passed connection test proves the earlier synthetic lifecycle, not this new chat execution path. Offline chat/tool and browser fixtures run with Docker disabled. The owner-approved single native Vercel check passed with exact output and verified deletion; the temporary test grant was revoked. Details are recorded in `docs/VERCEL.md`; SPACE server acceptance is deferred at the owner’s request.

## 2026-10-26 — Optional Microsandbox local execution

Adopt Microsandbox 0.7.11 as the first optional local microVM adapter. Ship only a pinned install recipe and isolated worker in core; install SDK/native libraries and the Node image on explicit setup. Keep the SDK local backend fixed and its environment separate from host credentials. The native agent runtime, ACP, MCP and cloud adapters remain unchanged in role.

Use one disposable network-disabled VM per bounded Node call, durable creation intent, an identity acknowledgment before execution, exact-resource destruction and unknown-outcome holds. Run SDK calls in a child process so native faults do not crash the service. Keep runtime records and images in a short private directory under `~/.a0-msb` because macOS socket path limits rejected the longer application-data location in live testing. Source upgrades cannot prevent recovery with the intact previously installed worker; unknown sandboxes still block replacement.

Actual Apple Silicon acceptance passed setup, chat integration through a local model fixture, isolation probes, execution/output limits, cancellation and interrupted-worker reconciliation with all six VM receipts deleted. This does not establish Linux, other SDK capabilities or hostile-kernel acceptance. See `docs/MICROSANDBOX.md`.

## Bash and BrowserPilot assessment — 2026-10-26

- Deliver sandbox Bash plus explicitly opted-in host Bash, as selected by the owner. Retain per-call sandbox isolation and billing bounds; do not silently promise persistent VM files or a PTY. Host cwd selections persist per chat.
- Reuse existing sandbox adapters, grants and cleanup ledgers. Add a Bash intent ledger for replay protection and unknown-outcome reviews. Keep old chat tool identities and exclude read-only subordinates.
- Use real Bash, a separate Docker Debian image and an updated optional Microsandbox image. No new npm dependency; images stay outside the core package.
- BrowserPilot has no open-source license. Adopt only independently implemented design concepts; do not vendor its code. See [assessment](research/BROWSERPILOT.md) and [Bash contract](BASH.md).

## 2026-10-26 — Include native first-run setup in alpha.2

Guide fresh npm users through model connection and explicit folder selection into the existing native runtime. Keep Agent Zero/ACP optional. ChatGPT uses the existing PKCE/account/model-catalog path; setup performs no inference. Default workspace creation reserves a durable ID and verifies ownership before recovery. Existing configured users keep their workspace and grants.

Optional local Bash setup reuses Microsandbox’s explicit installation, synthetic proof and cleanup gates. It adds no core runtime dependencies. Host Bash stays separately opt-in. The CLI opens the browser while keeping the pairing code in the terminal; `--no-open` supports headless use. Refine the existing Agent Zero visual identity, with light/dark choice, keyboard focus, readable steps and one restrained completion check; no new font, animation dependency or decorative labels.

## 2026-10-28 — Optional OpenShell gateway adapter

Use the official SDK 0.1.6 as a separately installed add-on. Its current GitHub Packages authentication requirement must not make the core public npm package dependent on that registry. Load it only in an owned, bounded worker; install instructions keep registry credentials in npm. Use explicit HTTPS, mTLS/CA or OIDC credentials in the vault, and no ambient CLI configuration or model-provider export.

Public health is not authenticated readiness. Verify protected current-user identity plus a workspace-scoped read, without demanding platform-admin gateway info. Show revision-bound, expiring connection evidence separately from execution and cleanup. Native runtime, ACP and MCP remain independent.

Synthetic execution uses durable intent, ownership labels, stable resource IDs, exact bounded output/exit checks and expected-ID deletion waiting. The upstream name-addressed delete/exec API has no atomic ID condition, so require a dedicated workspace, disclose the residual race, and refuse observed replacements. Never resend an uncertain command or deletion. Lost creation with no known ID requires ownership-matched discovery or an explicitly recorded operator absence review. Connection changes cannot clear holds; recovery verifies original endpoint/workspace/CA and principal.

The pinned public SDK source was built and exercised against a local TLS gRPC fixture; core fault tests and a separate live-gateway gate document the limits. Gateway installation, live compute and general OpenShell chat execution are not claimed by this preview. The user approved this implementation scope in the plan canvas workflow. See `docs/OPENSHELL.md` and `docs/plans/OPENSHELL.md`.

## 2026-10-28 — Capability-specific Hub routes and DB Hub companion

The owner approved the research plan in the canvas. Keep ACP for whole-agent sessions and correct the built-in Agent Zero MCP preset to describe chat delegation. Use a separately packaged, manually configured stdio MCP companion for explicit native SLIM tool access. The first adapter preserves Agent Zero policy, intervention, tool hooks, logging and secret masking for DB Hub status/schema. Limit it to existing local SQLite databases through SQLAlchemy on exact pinned framework/plugin source; do not generalize one driver's proof to every database driver or full plugin lifecycle.

The companion uses client-owned operation metadata, compatibility fingerprints, installation/project/profile scope, a durable SQLite journal and OS process exclusion. Changed config/source, hook-mutated arguments and unknown effects block execution. The Hub records tools, skills, lifecycle and UI separately and keys curated evidence by repository and commit. No automatic installer, Python core dependency, memory replacement or UI injection was added. Real Python-plugin execution on synthetic data is distinct from mocked model output, owner-instance acceptance and ACP task acceptance. See `docs/PLUGIN-COMPANION.md` and `docs/verification/PLUGIN-COMPANION.md`.

## Sandbox preferences and live ACP acceptance — 2026-10-29

Session Timeout defaults to 15 minutes, independently of short command deadlines and cleanup at the end of each call. Expose CPU/memory choices within documented entry-plan bounds; Vercel couples memory to CPU, E2B keeps its default template because custom sizing requires Pro, and Modal limits requested CPU/memory to prevent automatic bursting. Credit-based providers are not represented as guaranteed zero-cost: account quotas and remaining credit are authoritative. Daytona uses an explicit Python image because its pinned SDK accepts resource sizing only for image creation. See [Sandbox settings](SANDBOX-SETTINGS.md).

Persist selected sizing and original lifetime in receipts. Changes invalidate connection/grant revisions and existing Vercel/Microsandbox chats; unknown outcomes remain held until the original lifetime and identity checks allow reconciliation. Active operations retain their captured settings.

Live Agent Zero CLI 2.14 sends complete assistant snapshots as ACP message chunks. Normalize only that exact reported implementation into snapshot display events, preserving the original text in the journal. All other ACP agents/versions retain standard delta semantics. Local instance cookies include the port so simultaneous SLIM services cannot overwrite one another's browser pairing.

## Discoverable curl-installed command — 2026-10-29

Register the verified private launcher at `~/.local/bin/a0-slim`. If that directory is not in PATH, append one marked, backed-up block to the user shell configuration; preserve existing commands and configuration. Repeated installation does not duplicate entries. Do not replace global Node or write system profiles. Print a direct-launch fallback and explain the new-terminal requirement when a parent shell cannot inherit the installer’s environment. The default command reuses an existing default instance; separate instances require distinct port/data settings.

## Access modes and automatic MCP setup — 2026-10-29

The user approved Full Access, Approve for me and Ask for Approval in the plan canvas, with Approve for me as the new-project default. Implement one project policy revision and host-owned decision ledger. New native chats gain direct file and bounded web tools; opaque commands/tool effects ask in the two approval modes. Full Access is explicit OS-user authority. Inline approval returns the result to the same turn. Keep legacy identities, side-effect receipts and unknown-outcome holds unchanged.

Connecting MCP discovers/enables its tools automatically; optional tool switches retain opt-outs on refresh. Catalog fingerprints still bind each turn and pending operation. Compact snapshots plus on-demand schemas prevent auto-enable from overflowing prompt context. ACP auto-approval is restricted to an offered one-time grant. General code/MCP risk classification and external-agent confinement are not claimed. See [behavior and verification](ACCESS.md).

## Automatic managed updates — 2026-10-29

The user requested updates that are extremely easy or automatic. Enable daily startup updates for curl installations, with an explicit command for immediate installation and opt-out controls. Keep the already-running service intact; apply the new release on next startup. Use a fixed npm origin, exact tarball URL and SHA-512 integrity, the managed Node/npm runtime, an empty npm configuration, scripts-disabled installation and native/CLI probes before an atomic current-release switch. Retain the previous release and keep all private app data outside staging. Do not silently modify npm-managed packages or source checkouts. Embed the bootstrap updater and launcher from owned modules with a synchronization check, so an old public package can acquire update support without circular dependency. Record synthetic registry/local-artifact acceptance separately from public release availability.

## Customizable appearance — 2026-10-29

Implement the twelve named palettes and gallery/preview arrangement from the user’s references, with dark/light variants and three gradient presets. Keep editing scoped to the preview until Save, including density; Reset restores the saved preferences. Custom palettes use validated hex colors, readable text and accent contrast across surfaces and gradient interiors, and derived control colors. No executable CSS, remote assets or theme dependencies are introduced. Preserve legacy browser choices as custom palettes. Keep headings plain and omit eyebrow labels. The npm alpha.3 release also includes the previously verified Hub, access, MCP, sandbox, command-registration and automatic-update work.
