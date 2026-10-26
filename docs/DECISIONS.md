# Decisions and delivery stages

Review date: 2026-10-26.

| Decision | State | Rationale |
| --- | --- | --- |
| Product name: A0 SLIM | User requested | Consistent user-facing identity; repository `A0-SLIM`. |
| Local-first browser app and public repository | User confirmed | Local files and control, optional cloud services. |
| Preserve preliminary spec | Complete | Immutable original; revised specification is separate. |
| Node 24 LTS, TypeScript, Fastify, React/Vite, SQLite | Proposed | Supported runtime and a maintainable interactive UI without a desktop shell dependency. |
| libfx 0.0.14 with narrow runtime adapter | Proposed | Verified package API; pin pre-1.0 dependency and prove restart behavior. |
| ChatGPT via documented Sign in with ChatGPT | Proposed, compatibility gate | Bundled libfx Codex auth is not the same integration. |
| First sandbox: Vercel; second: E2B | Proposed | Two different backends must prove that the adapter is portable. Daytona follows. |
| Host execution is explicit opt-in | Proposed | Docker-free need not mean unrestricted execution by default. |
| Local embeddings optional; lexical recall works first | Proposed | Fast installation without downloading model weights automatically. |
| Plugin Hub discovery + explicit compatibility overlay | Proposed | Existing Python/Alpine plugins do not execute natively in Node. |
| Graphite/Paper themes, restrained accent, three-pane workspace | Proposed | Minimal daily workspace with customizable density and inspection. |

## Delivery sequence

1. **P0 — compatibility proofs:** libfx lifecycle, ChatGPT public flow, one cloud sandbox, logo provenance, distribution platforms.
2. **P1 — usable local alpha:** onboarding, providers, project chats, streamed activity, files, approvals, stop/recovery, appearance, one sandbox.
3. **P2 — beta capabilities:** durable memory, local model downloads, bounded delegation, MCP/skills, Plugin Hub compatibility, second sandbox.
4. **P3 — release:** migration/backup, security and restart drills, accessibility/performance, public documentation and versioned release.

Every stage has acceptance gates in the spec. Canvas approval starts P0; approval is not proof that those technical gates have passed. No timeline estimates are commitments.
