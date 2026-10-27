# Microsandbox

SLIM supports **Microsandbox 0.7.11** as an optional local Node.js execution adapter. It retains SLIM's native agent runtime, model connections, ACP and MCP. No Docker engine, sandbox account, Python, PyTorch or model subscription is needed for the local sandbox check. Model-backed chats still use their selected connection.

## Setup and status

1. Open **Environments → Microsandbox**. Acknowledge the runtime/image download and choose **Install Microsandbox**.
2. Setup installs the pinned npm graph with integrity verification and dependency scripts disabled. It checks the packaged executable version and host virtualization prerequisites, then pulls a digest-pinned Node 22 Bookworm Slim image with Bash. Setup has a ten-minute deadline and can be canceled. A failed or interrupted installation needs an explicit retry.
3. **Check runtime** verifies the installed executable and cached image without creating a VM. It is required again after restarting SLIM. This is distinct from execution acceptance.
4. **Run local sandbox check** creates one VM, writes and reads a synthetic note, then verifies removal. It makes no model request.
5. Select **Local Microsandbox · Node.js** under **Execution for new chats**. Existing chats keep their original execution setting. The chat header shows readiness, active work or a recovery requirement; idle readiness explicitly means no active VM.

The integration supports Apple Silicon macOS and Linux x64/arm64 with KVM. Local acceptance has been performed on Apple Silicon only. Windows and Intel Mac are not enabled by this adapter. Microsandbox itself remains beta; other SDK platforms and capabilities are not implied to be accepted in SLIM.

## Execution boundary

Each tool call creates a named local microVM with one vCPU, 512 MiB memory, a 512 MiB writable root disk, guest networking disabled, no published ports and no project mounts. The Node process runs as UID/GID 65534 with a restricted guest security profile. Only explicit code and stdin input enter the VM; host credentials, npm configuration and model keys are not inherited. OCI image defaults such as PATH remain present. The host uses an isolated environment and explicitly selects the SDK's local backend.

Code is limited to 32 KiB, input to 64 KiB, combined output to 64 KiB, and three calls per turn. The Node supervisor enforces a five-second child timeout and a 128 MiB JavaScript heap limit. The SDK command has an eight-second timeout, the VM has a 60-second maximum duration and a 30-second idle limit. Cleanup is still required: a timeout is not evidence of termination or deletion. Returned text can be proposed through SLIM's existing artifact review; no files are automatically copied back to the project.

No arbitrary shell, mounts, networking, snapshots, forks, resume or cloud-backend configuration is exposed in this initial adapter. Those are separate upstream capabilities, not this adapter's accepted contract.

## Recovery

SLIM records creation intent before launching the optional worker. The worker returns the stable sandbox identity and waits for SLIM to persist it before receiving permission to execute one command. Receipt, host and private runtime identities bind every cleanup action. Destruction uses the SDK's identity-checked handle, then verifies absence; it never starts a stopped VM. A same-name replacement is rejected.

Cancellation terminates the worker and independently attempts cleanup. Interrupted service receipts become recovery holds. Use **Recheck and remove** to inspect and remove the original resource. An unresolved outcome blocks new creation, installation changes and runtime removal. Recovery never replays code; identical calls in the same turn return their existing receipt even if the runtime call ID changed after restart.

A lookup failure is not absence. Even a typed not-found result cannot release a creation whose identity was never confirmed. For that case, wait at least two minutes, inspect the runtime for the exact recorded name and any outstanding creation process, then use **Review absent sandbox** to record the inspection. SLIM checks absence again and retains the failed/interrupted execution record plus a separate review record. The review does not establish successful execution.

## Storage and packaging

Only the small manifest, shrinkwrap, worker and runtime configuration ship in SLIM's tarball. The SDK and native binaries are not core dependencies. Setup installs them under `<data>/addons/microsandbox`. Native code loads in a child process, never in the server.

The SDK's durable image/VM storage lives in `~/.a0-msb/<data-directory-hash>`, with private user-only permissions and a runtime identity marker. This short path avoids macOS's 104-byte Unix socket limit. SLIM's default Application Support directory is too long for some SDK socket paths. Do not move or delete the runtime directory while cleanup is unresolved. Runtime removal preserves this cache and recovery data; installation never silently removes VM records.

On Apple Silicon the platform package alone is approximately 96 MB unpacked, before images, SDK files and runtime cache. The complete installed SDK/runtime measured about 97 MB; the pinned Node image/cache after one check added about 174 MB (about 271 MB combined). See [packaging](PACKAGING.md) for current core measurements.

## Verification

Run deterministic tests with `npm run check`. They cover setup/retry/removal, proof versus runtime readiness, restart holds, replay prevention, lost creation replies, cancellation cleanup, identity rejection and API authorization. They do not create VMs.

Explicit local acceptance (downloads public artifacts and runs disposable VMs):

```sh
node --import tsx tests/helpers/microsandbox-live-check.ts
```

On 2026-10-26, Node 24.22.1 / macOS arm64 passed optional setup, synthetic file round trip, a native libfx chat using a local model fixture, host-file/environment isolation checks, denied guest networking, code timeout, output limit, cancellation cleanup, and native worker interruption followed by restart reconciliation. All six sandbox receipts ended with verified deletion. This uses actual local microVMs; it is not live model-account, cloud, Linux or hostile-kernel security acceptance.

Sources: [Microsandbox SDK and runtime](https://github.com/superradcompany/microsandbox), [0.7.11 release](https://github.com/superradcompany/microsandbox/releases/tag/v0.7.11), [published SDK](https://registry.npmjs.org/microsandbox/0.7.11). Integration APIs and dependency integrity were checked against the published 0.7.11 package. The logo comes from the official documentation favicon; its source and digest are in `ui/public/providers/sources.json`.
