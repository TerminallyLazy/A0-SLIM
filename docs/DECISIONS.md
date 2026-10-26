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
