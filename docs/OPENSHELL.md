# NVIDIA OpenShell

SLIM can connect to an existing **OpenShell 0.1.6 gateway**, verify health and access, and run one temporary synthetic sandbox check. This is a separate adapter from Docker, Microsandbox, ACP and MCP. General OpenShell chat execution is not enabled in this preview. A passing check does not keep a sandbox connected.

## Setup

1. Provision a gateway using NVIDIA's [installation guide](https://docs.nvidia.com/openshell/latest/about/installation). SLIM does not install or start a gateway. A remote gateway does not require Docker on the SLIM computer; the gateway's own runtime requirements still apply.
2. Prepare a dedicated workspace (for example `slim-checks`) and an image supported by that gateway with `sh`, `mktemp`, `cat` and `rm`. Give the caller workspace read/write and execution access. Avoid another client reusing SLIM's random check names.
3. Install the optional official TypeScript SDK **0.1.6**. NVIDIA currently distributes `@nvidia/openshell-sdk` through GitHub Packages; the public npm registry returned 404 during this assessment. Follow NVIDIA's [SDK installation instructions](https://docs.nvidia.com/openshell/latest/sdk/typescript) to configure the `@nvidia` registry and authenticate npm with a GitHub token with `read:packages`. Keep that token in npm, never in SLIM or chat.
4. In **Environments → NVIDIA OpenShell → Install the optional SDK**, copy and run the command. It installs into the displayed SLIM data directory, with npm lifecycle scripts disabled. The command pins the direct SDK version; npm records the resolved transitive versions locally. No SDK, VM binary, image, gateway or new runtime dependency is added to the core npm graph.
5. Choose **Set up connection**. Enter an HTTPS gateway origin, workspace, image and authentication method. Use either an OIDC bearer token or the gateway's mTLS client certificate/private key, plus a CA certificate if its server certificate uses private trust. Default local gateway credentials are documented at `~/.config/openshell/gateways/<name>/mtls/{ca.crt,tls.crt,tls.key}`. SLIM does not discover or import them silently. It validates the client key/certificate pair, encrypts secrets in its vault and never returns them to the UI.
6. Click **Check connection**. This is read-only. Setup and sign-in links lead to NVIDIA's documentation; OpenShell is not a hosted account signup or a model subscription.

Blank secret fields retain credentials only for the same gateway and authentication method. A changed gateway requires new credentials. Clearing the CA explicitly switches to system roots. TLS verification is always enabled; plaintext origins, insecure verification, embedded URL credentials and path/query/fragment origins are rejected. No provider credential export or model-key forwarding is used. This preview accepts a manually renewed OIDC token; browser login, Edge tokens and renewable client-credential flows are not implemented.

## What connection status proves

- Constructing `OpenShellClient` is lazy and performs no network request.
- `health()` checks the public gateway health endpoint. A healthy response alone does not establish authentication.
- Protected `getCurrentUser` verifies the caller; SLIM retains a hash of its provider/subject for recovery continuity. It does not store display names, roles or scopes in public receipts.
- A single protected `listSandboxes` page checks read access to the **explicit workspace**. It does not require privileged gateway-info or provider-export access. Write/exec permission is tested only by the separate synthetic check.
- SDK and gateway must be 0.1.6. Checks show their timestamp, expire after ten minutes, and are invalidated by settings or credential changes. Rendering/polling the UI makes no gateway requests.
- The page says **No sandbox is kept connected to chat**. A historical receipt is not an active connection or an execution grant.

## Synthetic check and recovery

The user acknowledges compute/image-pull costs and use of a dedicated workspace with manual cleanup access. The check refreshes access, records an intent before creation, and uses a random name and host/receipt ownership labels. It passes no project files, environment secrets, mounts or model provider attachments. Once ready, the owned sandbox runs a fixed temporary-file round trip. A 30-second execution deadline, a 16 KiB output cap, exact expected bytes and a zero terminal exit are required. Each SDK operation runs in an owned child process with a bounded lifetime and a minimal environment. On interruption, SLIM waits for that child to exit before releasing its operation lock.

There is **no asserted sandbox lifetime or egress guarantee**. These are gateway/runtime policy responsibilities; command timeout or client process death does not stop remote compute. A blocked creation, network outage or shutdown may leave a sandbox needing manual cleanup.

SLIM records delete intent before dispatch, checks name/ID/ownership and compares the returned deletion ID to the original. It waits with `waitDeleted(name, ..., { workspace, expectedSandboxId: originalId })`, even after an accepted deletion. Only confirmed absence of that known ID clears automatic recovery. A same-name replacement observed during recovery is left untouched. A response with a different deletion ID requires operator review.

**0.1.6 API limitation:** the delete RPC takes a name, with no atomic expected-ID precondition. Ownership checking cannot eliminate a replacement race between lookup and deletion. The synthetic check therefore requires a dedicated workspace and an explicit acknowledgment that another client will not reuse the name. This preview does not claim arbitrary multi-client deletion safety. The same name-addressed limitation applies to command dispatch; commands are fixed and synthetic.

Unknown outcomes block new OpenShell creation across restarts and configuration changes. **Recheck and clean up** restores the original gateway/workspace/authentication method/CA and verifies the original principal; token or certificate rotation for that identity is permitted. Recovery never creates or repeats the command. Once a delete intent exists, it is never resent automatically. If that delete did not reach the server, the operator must remove the resource there before rechecking.

A lost creation without a known ID stays unresolved when lookup finds nothing: a delayed create could still arrive. An owned resource can be adopted for cleanup by its exact random name and both labels. Alternatively, an operator can inspect the original gateway, verify no pending creation/resource remains, and record an absence review. SLIM rechecks authentication, workspace access and name absence, preserving the original failed/interrupted result. This is an operator review, not proof of successful execution or deletion.

## Validation

Baseline source: NVIDIA/OpenShell [`v0.1.6`](https://github.com/NVIDIA/OpenShell/tree/v0.1.6/sdk/typescript), commit `ac7f615cd12d5cc49cb16eb1f5f10ffeb1e90f47`.

- `tests/openshell.test.ts` covers lifecycle and fault handling, credential persistence/redaction, changed/stale states, failed lookup, lost create/delete, same-name replacement, mismatched deletion ID, restart/shutdown, identity continuity, TLS input validation, output bounds, stream completeness and API acknowledgments.
- `tests/helpers/openshell-sdk-check.ts` is opt-in: `npx tsx tests/helpers/openshell-sdk-check.ts /absolute/path/to/installed-sdk`. It uses the actual SDK and generated service against a temporary local TLS HTTP/2 gRPC fixture. It verifies explicit workspace wire fields, bearer-auth failure despite healthy public health, client certificate presentation, untrusted CA rejection, exact stdout/exit handling and expected-ID deletion waiting with a replacement left untouched. It consumes no gateway or model allowance.
- The SDK was built locally from the pinned public source (`npm ci --ignore-scripts`, `npm run gen`, `npm run build`); only its temporary package version was set to 0.1.6 as upstream release CI does. This validates the pinned source contract, **not a downloaded GitHub Packages artifact**.
- **Live gateway acceptance remains pending.** Needed: an accessible 0.1.6 HTTPS gateway, dedicated workspace, supported image, SDK installation and credentials entered in the app. Obtain approval for one temporary compute check, then retain its resource ID, verified output and cleanup receipt. Do not enable chat execution based on local fixtures.

Sources: [SDK](https://docs.nvidia.com/openshell/latest/sdk/typescript), [gateway authentication](https://docs.nvidia.com/openshell/latest/how-it-works/gateways/authentication), [protocol](https://github.com/NVIDIA/OpenShell/blob/v0.1.6/proto/openshell.proto), [SDK lifecycle implementation](https://github.com/NVIDIA/OpenShell/blob/v0.1.6/sdk/typescript/src/client.ts).
