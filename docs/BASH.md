# Bash

Included in `a0-slim@0.1.0-alpha.2` and later.

New native chats expose `bash` when a sandbox is selected or host Bash has been explicitly enabled for the project. Existing chats retain their tool identities; start a new chat after changing permissions. ACP agents retain their own execution policies. Read-only subordinates do not receive Bash.

```json
{"command":"items=(paper garden); printf '%s\\n' \"${items[*]}\" | sort","target":"sandbox","input":"","timeout_ms":10000}
```

The tool executes `/bin/bash --noprofile --norc -o pipefail -c` with arguments and stdin passed separately. It supports scripts, pipelines, redirects, loops and heredocs. It does not substitute another shell if Bash is missing. stdout, stderr, exit code, timeout, truncation, cancellation, working directory and receipt ID are inspectable in the conversation and Environments.

| Boundary | Sandbox | Host |
| --- | --- | --- |
| Execution | Chat's frozen Docker, Vercel or Microsandbox adapter | Explicit per-project permission; frozen grant revision per chat |
| Lifetime | Disposable per call; combine related steps into one script | Fresh shell per call; host files persist |
| Working directory | `/work` in Docker, `/tmp` in Vercel/Microsandbox by default | Project folder initially; explicit `cwd` selections retained per chat |
| Shell state | `cd`, variables and functions last one call | `cd`, variables and functions last one call |
| Time | 10 seconds default, up to 30 seconds | 10 seconds default, up to 30 seconds |
| Output | 32 KiB combined stdout/stderr | 32 KiB combined stdout/stderr |
| Input | 16 KiB script and 16 KiB stdin, encoded total up to 64 KiB | Same |
| Access | No automatic project upload, credentials, host mounts or outbound network | OS account's file and network access, including outside the project |

These are noninteractive scripts, not persistent PTYs. Shell variables and background jobs are not preserved. Long builds, interactive prompts and persistent sandbox files require a future session API with explicit lifetime, cleanup and billing controls.

## Setup

- **Vercel:** retain the existing passing connection check and project cloud-use grant. Bash uses the same disposable VM with the selected session timeout (15 minutes by default), three-call per-turn and ten-call per-ten-minute budgets as Node. No Docker dependency. A Bash failure never selects host execution automatically.
- **Docker:** start the local engine and install the separate Bash-capable image: `docker pull node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`. The previous Alpine image remains supported for existing Node calls. Bash image presence is shown separately in Environments.
- **Microsandbox:** update the optional add-on in Environments and rerun its check. The image is now digest-pinned Node 22 Bookworm Slim with real Bash. Existing installed workers remain available to reconcile their original VMs before update. The larger image is an optional runtime download, not part of the core npm archive.
- **Host:** in Environments, read and select the explicit project permission, then enable host Bash and start a new chat. `/bin/bash` on macOS or Linux is required. Disabling it cancels current host commands and blocks dispatch from old chats. Re-enabling produces a new grant; old chats do not regain access.

Host Bash can directly read and modify files, make network requests, and access credentials stored on disk. A working directory is not isolation and host commands bypass the staged artifact review. The child receives a small explicit environment; shell startup profiles, `BASH_ENV`, `NODE_OPTIONS`, model keys and other inherited variables are excluded. This does not make host execution safe for untrusted commands. Use a sandbox for isolation.

## Recovery

SLIM records an intent and input digest before launching a command. Repeated tool IDs with different inputs are rejected. The same script/input/cwd in the same turn returns its original receipt even if the runtime supplies a new execution ID after restart. To intentionally repeat identical work, use a new user turn. Scripts and stdin are not copied to receipts; tool arguments remain in normal conversation history, and bounded output is retained locally.

Timeout, output overflow and cancellation stop the shell process group. The host supervisor watches its parent IPC connection and attempts to stop children if SLIM exits. Deliberately daemonized processes can escape a process group: host Bash is trusted execution, not a process sandbox. Sandbox deletion is the outer containment boundary.

An interrupted supervisor or lost sandbox response remains **unknown**, never silently retried. Host uncertainty blocks subsequent Bash execution until a user reviews effects and any remaining processes in Environments. Never kill a stored PID without checking identity; PIDs can be reused. Sandbox cleanup still requires the original adapter's exact-resource reconciliation. The separate user review retains the unknown outcome and records the user's assessment; it does not assert rollback, successful execution or process termination.

## Validation

`tests/bash.test.ts` and `tests/bash-api.test.ts` cover real host Bash against disposable test folders, native chat dispatch, explicit pairing/permission, revocation, cancellation, output bounds, timeout, environment isolation, replay suppression, unknown recovery and a synthetic Vercel SDK peer.

Explicit local checks (not part of CI) are `npx tsx tests/helpers/bash-local-check.ts docker` and `npx tsx tests/helpers/bash-local-check.ts microsandbox`. The latter installs the optional runtime and image into disposable synthetic data. Neither consumes a live model account. A live Vercel Bash check is a separate billed-provider acceptance step and has not been run for this change.
