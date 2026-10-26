# Perplexity SPACE integration assessment

Researched 2026-10-26 at the owner's request. This is the integration design; no SPACE server, credentials or sandbox were created, and no live compatibility is claimed.

## Fit and deployment

SPACE supplies HTTP-managed sandboxes and command streams. It belongs in SLIM's execution registry, separately from model providers, ACP agents and MCP tools. The project is Apache-2.0; that does not supply free hosting or compute credits. The supplied documentation describes operating your own deployment rather than signing up for a managed Perplexity sandbox account. [Introduction](https://space.docs.perplexity.ai/guide/index.html), [repository and license](https://github.com/perplexityai/SPACE/tree/dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1).

The documented installation uses Linux x86_64 with KVM, required host devices, privileged Docker and a Kind/Kubernetes stack. It does not run directly on this Mac. A SLIM client on macOS can communicate with a separately provisioned Linux deployment. The guide asks for at least 30 GiB free in both relevant storage locations. Architecture documentation also describes a direct worker adapter, so Kubernetes is the documented setup path, not a universal runtime requirement. [Installation](https://space.docs.perplexity.ai/guide/installation.html), [architecture](https://space.docs.perplexity.ai/guide/architecture.html).

## Version and interface selection

The docs identify SPACE **0.8.0**, source **`dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1`**. The downloaded public API reference has SHA-256 `e14874565d79f30c37f20d9fb4754362f547ef2911d89378bcbe5ad54b1a0029`. Treat this as a researched baseline, not proof that an owner's server matches it. Inspect the deployed `/openapi-m1.json`; exclude incubating features until separately validated. Before 1.0, minor releases may break compatibility. [API](https://space.docs.perplexity.ai/api/index.html), [version policy](https://github.com/perplexityai/SPACE/blob/dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1/docs/versioning.md).

Use a small native TypeScript HTTP/SSE adapter. No Rust embedding or Python sidecar is necessary. Do not reuse SLIM's E2B SDK connection by changing its hostname: SPACE's compatibility wrapper is a separate service with different credentials/routing, and its documented tested baseline is Python `e2b==2.21.1` / `e2b-code-interpreter==2.6.2`; JavaScript remains unverified. [Repository API guidance](https://github.com/perplexityai/SPACE/blob/dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1/README.md), [ECW contract](https://github.com/perplexityai/SPACE/blob/dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1/docs/ecw.md).

## Proposed SLIM contract

Add a separate `SpaceConnection` and receipt-aware `SpaceProof`, rather than widening `CloudCheck` with assumptions its interface cannot express. Current `CloudCheck.cleanup` accepts resource absence as deletion; SPACE requires a successful delete operation and can conceal unauthorized resources behind not-found responses. Retain existing E2B/Daytona behavior unchanged.

Configuration should include a management origin, management API prefix (`/v1` or explicitly configured `/api/v1`), data-plane origin, published template reference, requested resource limits and encrypted management token. Save public endpoints independently so they persist while the token remains write-only. Do not inherit environment credentials or proxies. Require HTTPS outside loopback, reject credential-bearing URLs, and refuse redirects. Never send the management token to a data-plane attachment URL. Recovery remains bound to the original deployment and verified principal; token rotation needs verified identity continuity, not only a new token hash.

The first delivery should expose **Check connection** (read-only auth/API-version inspection) separately from **Run synthetic check** (explicit resource-use acknowledgment). Use deployment-specific **Open console**, **Sign in** and **Setup guide** links. Label this provider **SPACE · self-hosted**, with official Perplexity artwork and recorded provenance when the UI is implemented; do not invent a hosted signup link or free-tier promise.

### Lifecycle sequence

| Step | Required evidence |
| --- | --- |
| Create | Persist exact method/path/body and idempotency key before POST; retain every valid sandbox/operation ID even in a partial response. |
| Ready | Create operation succeeds, sandbox reports running, and its process endpoint is ready. |
| Command | Persist command intent/key, create the command session, then validate attachment origin, exact session path, token transport and expiry before attaching. Attachment starts execution. |
| Output | Parse bounded UTF-8 SSE frames and base64 output. Require a clean terminal `process_exited` with exit code zero; error, resync or truncated output cannot pass. |
| Cleanup | Save deletion intent/key and operation ID, poll success, and retain the receipt. A 404 alone is not successful deletion. |

The official walkthrough explicitly keeps recovery state and distinguishes HTTP acceptance from command completion. It also separates management and attachment tokens and treats incomplete streams as failures. [First sandbox guide](https://space.docs.perplexity.ai/guide/first-sandbox.html), [pinned executable example](https://github.com/perplexityai/SPACE/blob/dc9e22d80521cf2a0d2822629f8bd4a43dbcafe1/examples/first_sandbox.py).

Idempotency is endpoint-specific and retained for 24 hours. Reuse the exact original request only within its documented window; an expired key or fresh key may create another effect. Preserve request IDs and provider error codes. Reconnecting output must use the exact event ID and stop on `resync_required`; creating another command is not reconnecting its output. Default idle suspension is not a hard lifetime or cleanup guarantee, and policy fields marked incubating must not become an asserted safety boundary. [OpenAPI contract](https://space.docs.perplexity.ai/api/openapi.json).

## Implementation gates

1. Build the dedicated adapter and private receipt journal against fixtures for 0.8.0. Test token separation, hostile attachment URLs, redirects/proxies, partial IDs, late operation failures, lost create/delete responses, unknown future states, expiry, SSE chunk boundaries and exact terminal evidence.
2. Add the provider form/status/receipts and sourced logo, preserving existing native execution selection. Cloud agent execution remains disabled until its separate conformance gate passes.
3. Use an owner-provided SPACE deployment with a published compatible template and a scoped account for one approved synthetic create/execute/delete check. Do not provision Linux infrastructure on the owner's behalf without a specific deployment request.
4. Broader workspace transfer, interactive terminals, suspend/wake, snapshots and arbitrary agent execution require independent capability tests. Public M1 lacks a stable native file API, so do not imply artifact/workspace parity from a stdout-only check.

The immediate implementation input is the SPACE deployment the owner intends to use. Offline adapter work is possible before that input; live acceptance requires its management/data-plane endpoints, version, template and authentication configured privately in SLIM.
