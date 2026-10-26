# Decisions and delivery stages

Approved by the user in chat on 2026-10-26. The canvas review is closed.

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
| Graphite/Paper themes, restrained accent, three-pane workspace | Approved direction | Minimal daily workspace with customizable density and inspection. |

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
- E2B uses explicit API credentials, the official endpoint, zero API retries, denied outbound/public traffic, no mounts, a 60-second kill timeout and no auto-resume. Recover by exact receipt metadata, without connecting/resuming. An empty result after lost creation remains unknown.
- Daytona uses explicit API credentials and endpoint, US region, private preview, denied outbound network, no volumes/secrets, one-minute lifetime and automatic deletion. SDK state polling avoids an unnecessary persistent WebSocket. Version 0.226.1 reads tracing flags from the environment even when disabled in options; synchronous construction forces these two flags off and restores their prior values immediately.
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
- Do not call the source distribution tiny: the optional inference worker's runtime dependencies occupy roughly 441 MiB in this macOS checkout. Packaging them as a separate install is still release work.
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
