# Bash acceptance — 2026-10-26

Delivered in the source build. The public npm release remains `0.1.0-alpha.1`; it does not contain Bash yet.

## Verified

- `npm run check`: 126 tests pass, TypeScript checks and production build pass on macOS arm64, Node 24.22.1. Includes unchanged native restart/file-evidence and no-execution identity regressions.
- Real host Bash in disposable test folders: arrays, literal heredocs, stdin, pipefail, selected cwd persistence, environment exclusion, output cap, timeout, cancellation, grant revocation and changed-grant rejection.
- Hard-killed synthetic service: the IPC watchdog stops the supervised shell group, the delayed test file is not written, and restart retains an unknown receipt and recovery hold.
- Real Docker and Microsandbox 0.7.11: Bash arrays/redirection/stdin, temporary files, stderr, host-file isolation, six-second scripts beyond the legacy Node timeout, configured timeout, pipefail, output overflow and verified resource removal. Optional runtime/image setup used isolated synthetic data and was removed afterward. Local Docker's separately pulled Bash image remains cached.
- Local Vercel SDK fixture: selected provider, existing usage grants/budgets, bounded command envelope, cleanup, lost command result and replay suppression. No real Vercel compute or live model account was used.
- Native libfx round trip and browser rendering: a fixed local model calls Bash; complete stdout, stderr and exit status are recovered from the receipt despite the SDK's truncated result preview. The saved transcript reopens correctly. Host permissions are visible separately from sandbox state.
- Packed npm artifact installs and starts twice, loads bundled UI/SQLite/native libfx and preserves early cancellation; optional embeddings remain separate. Core dependencies are unchanged. The measured local archive is approximately 456 KB compressed and 1.93 MB unpacked, with approximately 201.7 MB of installed production files including dependencies. Images and optional runtimes are outside these sizes.
- `npm audit --audit-level=high`: zero reported vulnerabilities.

## Remaining boundaries

- Live Vercel Bash acceptance requires a separately approved temporary sandbox check. Existing live Node execution evidence does not prove this new Bash path.
- Sandboxes are disposable per call. Persistent shell sessions, PTYs, long-running services and cross-call sandbox files are not delivered.
- Host Bash has OS account access. Process-group cleanup is not isolation from deliberately detached processes; unknown outcomes require inspection, not blind PID killing or effect replay.
- Microsandbox users need to update the optional add-on and rerun its check for the new pinned Debian image. Original installed workers remain available for recovery first.
- BrowserPilot was researched, not integrated. Its code was not copied; the optional browser adapter contract is recorded separately.
