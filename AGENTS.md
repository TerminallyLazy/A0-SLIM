# A0 SLIM project guidance

## Scope

This is an independent, local-first Node/TypeScript project. The authoritative proposed design is `A0-SLIM-SPEC.md`. The initial repository contains research and review artifacts; do not describe the application as implemented.

## Ownership and contracts

- Preserve `docs/original/A0-SLIM-SPEC.md` byte-for-byte.
- Keep the Agent Zero reference checkout read-only.
- Application implementation begins after the user's plan-canvas verdict or explicit instruction to proceed. Repository setup and review artifacts are already authorized.
- Prefer small owned modules and explicit registries. Keep libfx-specific behavior behind the runtime adapter; provider, embedding, sandbox, and plugin contracts are distinct.
- Never commit credentials, runtime sessions, personal workspace contents, downloaded model weights, or private diagnostic output.
- Every compatibility claim must identify its version, tested capability, and evidence. Authentication readiness is not successful inference; a catalog entry is not plugin compatibility.
- Keep the spec, decision log, and README aligned with delivered behavior. Record unresolved gates without inventing acceptance.
- Before commits, inspect the diff and stage only task-owned files. Push authorized project changes and verify the remote ref.

## SkillOpt-Sleep

Use the skillopt-sleep skill only when the user asks for a sleep/dream/offline self-improvement cycle. Runner: `bash "$HOME/SkillOpt/plugins/run-sleep.sh" status --project "$(pwd)"`.
