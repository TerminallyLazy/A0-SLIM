# A0 SLIM project guidance

## Scope

This is an independent, local-first Node/TypeScript project. The authoritative approved design is `A0-SLIM-SPEC.md`. A P0 foundation application is implemented. P0 and P1 acceptance remain incomplete; consult `docs/verification/P0.md` for delivered behavior and open gates.

## Ownership and contracts

- Preserve `docs/original/A0-SLIM-SPEC.md` byte-for-byte.
- Keep the Agent Zero reference checkout read-only.
- The user explicitly approved implementation on 2026-10-26. Continue the approved sequence; do not invent a new permission gate for ordinary implementation. Real-account acceptance must be evidenced separately.
- Prefer small owned modules and explicit registries. Keep libfx-specific behavior behind the runtime adapter; provider, embedding, sandbox, and plugin contracts are distinct.
- Never commit credentials, runtime sessions, personal workspace contents, downloaded model weights, or private diagnostic output.
- Every compatibility claim must identify its version, tested capability, and evidence. Authentication readiness is not successful inference; a catalog entry is not plugin compatibility.
- Keep the spec, decision log, and README aligned with delivered behavior. Record unresolved gates without inventing acceptance.
- Before commits, inspect the diff and stage only task-owned files. Push authorized project changes and verify the remote ref.

## SkillOpt-Sleep

Use the skillopt-sleep skill only when the user asks for a sleep/dream/offline self-improvement cycle. Runner: `bash "$HOME/SkillOpt/plugins/run-sleep.sh" status --project "$(pwd)"`.

## Verification

Use Node 24 (`.node-version`). Run `npm run check` and `npm audit --audit-level=high`. The libfx cancellation patch is installed by `postinstall` and checks exact upstream/patched hashes. Do not remove it without proving early stream cancellation exits cleanly. Preserve the crash-recovery limitation test; passing that test documents a blocker, not safe side-effect replay.
