# SPACE setup and recovery

SPACE is self-hosted sandbox infrastructure from Perplexity. SLIM connects to it over native HTTP and server-sent events. The adapter targets the **0.8.x public M1 API**; its inspected and fixture-tested baseline is **0.8.0**, source `dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1`. Live server acceptance is still pending. It does not use the E2B compatibility wrapper or an ACP agent.

## Connect your deployment

1. Provision or obtain access to a SPACE deployment using its [installation guide](https://space.docs.perplexity.ai/guide/installation.html). The documented server requires Linux x86_64/KVM and privileged infrastructure; it cannot run directly on this Mac. SLIM does not install or provision it. Open-source licensing does not provide free hosting or compute credits.
2. In **Environments → SPACE → Set up connection**, enter the management origin, data-plane origin and console origin. Use HTTPS, or a local loopback tunnel. Origins contain no path, credentials, query or fragment. Choose the management prefix `/v1` or `/api/v1` used by your deployment. Authentication and schema routes remain at the origin root.
3. Enter a published template reference, supported runtime and requested CPU/memory/disk. The template must provide `sh`, `mktemp`, `printf`, `cat` and `rm`. These are resource requests, not proof of actual guest capacity. Ask your operator which template and sizing to use; `seed:latest` is only an example.
4. Sign in through your deployment's console and obtain its management bearer token privately. Save it in SLIM's password field. The token is encrypted in SLIM's local vault and is never returned to the browser. Reopen settings to inspect public endpoints. A blank token keeps the existing token only for the same management origin. Changing that origin requires a new token.
5. Click **Check connection**. This reads `/openapi-m1.json`, `/auth/v1/me`, `/auth/v1/cluster` and the sandbox listing. No sandbox is created. The auxiliary auth routes must be exposed by the deployment; email, full account responses and tokens are not retained in public evidence. The UI distinguishes not configured, unverified, changed, passed and failed checks, with a timestamp. A passing check is historical evidence, not continuous connectivity or an active sandbox.

There is no hosted SPACE signup in this integration. **Open console / sign in** opens your saved console origin. Requests use direct connections, ignore proxy environment variables, refuse redirects and never put tokens in URLs. Use a direct HTTPS endpoint or a loopback tunnel if your deployment normally relies on a proxy.

## Synthetic execution

Open **Test sandbox execution** after a recent passing connection check. Acknowledge compute use and your ability to clean up if the connection fails. The check creates one named sandbox, waits for its create operation, verifies ownership and process readiness, creates a 30-second shell command, attaches to its output, writes/reads/removes a temporary synthetic note, and requests sandbox deletion.

Only the fixed synthetic command and ownership metadata are sent. No project files, model credentials or user instructions are uploaded. Session attachment starts the command. Its scoped attachment token is sent only to the exact session path on the configured data-plane origin. Complete bounded output and a matching `process_exited` event with zero exit code are required. Error/resync events, invalid base64, malformed or truncated streams, timeouts and nonzero exits cannot pass. This delivery does not reconnect or replay commands.

The 30-second command timeout **does not bound the sandbox lifetime**. Stable M1 does not provide the hard TTL or enforced egress guarantees used by SLIM's other proof adapters. If deletion fails, resources may continue consuming your server capacity until you reconcile them. General agent execution, native file transfer, interactive terminals, suspend/wake and snapshots are not enabled.

## Recovery

A private local receipt records exact create, command and delete requests and idempotency keys before dispatch, plus confirmed resource/operation IDs. It never contains management or attachment tokens. Restarted in-progress checks are marked interrupted; unknown outcomes block new SPACE sandboxes even if settings are changed.

Use **Recheck and clean up** on the original receipt:

- SLIM verifies the original management/API/data-plane scope and the account, organization and cluster. Renewed credentials work only if that identity is unchanged.
- If creation lost its response, recovery polls its saved operation or reads the complete paginated sandbox list and finds the exact unique name and ownership metadata. It never replays creation or a command. An empty, incomplete or failed listing does not clear the hold.
- Known creation operations must reach a terminal state before deletion. SLIM verifies sandbox ownership before sending the first delete.
- If the delete operation ID was saved, recovery only polls that operation. If its response was lost, recovery can resend the exact original DELETE with the same key/body within SPACE's documented 24-hour idempotency window. After expiry it holds for operator review instead of sending a new key.
- Only a matching successful delete operation records **deleted**. A resource or operation returning 404 can conceal authorization changes and never counts as cleanup evidence.

After at least 24 hours, **Record a provider review** can release an absence hold when the owner explicitly confirms that the exact resource is absent and no related operation remains pending. SLIM still verifies the original identity, terminal state of known create operations, and a complete listing with no owned resource. The result is **reviewed absent**, not deleted; the original failed/interrupted check stays intact. If those conditions cannot be verified, the hold remains and the SPACE operator must resolve the server-side evidence.

## Live acceptance inputs

Provide the management, data-plane and console origins, deployment version, published template and supported resource sizing. Enter the management token directly into SLIM; do not send it in chat. Once **Check connection** passes, authorize one synthetic create/execute/delete check with the two acknowledgments. We will verify the actual command output and delete operation before calling the live integration accepted.

Local verification: `npm run check`, `npm audit --audit-level=high`. The automated fixture server never contacts SPACE. Optional browser harness: `npx tsx tests/helpers/space-ui.ts` on port 4311, using temporary data and fixture credentials only. The real application must be paired again if the harness replaces its same-host browser cookie.
