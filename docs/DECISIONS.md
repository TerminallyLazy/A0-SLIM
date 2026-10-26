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
