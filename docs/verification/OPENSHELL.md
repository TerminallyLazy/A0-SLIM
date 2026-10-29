# OpenShell preview verification

Date: 2026-10-28. Scope: separate optional gateway adapter, setup, status, synthetic lifecycle and recovery. This is development-source evidence, not a new npm release or live gateway acceptance.

## Local results

- Node 24.22.1: `npm run check` passes **144 tests**, type checking and production build. Twelve OpenShell tests cover connection and lifecycle boundaries, unknown effects, credentials, shutdown and consent. Existing native/ACP/MCP/recovery tests remain intact.
- `npm audit --audit-level=high`: zero vulnerabilities in the core graph. OpenShell has no core npm dependency.
- `npm run test:package`: packed CLI starts twice, pairs and serves UI/API; its OpenShell endpoint reports unconfigured with SDK absent. The SDK cannot resolve from the installed core. The package contains the adapter/worker, small install manifest, guide and artwork/license; no gateway, SDK dependency tree, model or sandbox image.
- Browser check on an isolated fixture at loopback: saved gateway/workspace/image persist; secrets return blank; saving blank secret fields retains credentials and connection revision; gateway health/auth/workspace status are separate; both usage acknowledgments are required; successful synthetic cleanup returns to no connected sandbox. This is fixture evidence, not provider success.

## Actual SDK protocol check

The official v0.1.6 source was retrieved at `ac7f615cd12d5cc49cb16eb1f5f10ffeb1e90f47`, installed with its lockfile, generated with its Buf configuration and built. Its temporary package metadata version was set to 0.1.6, matching the release process; production source was not modified. No GitHub Packages credential was used or artifact claimed verified.

`tests/helpers/openshell-sdk-check.ts` used that real SDK in SLIM's child process against a local TLS HTTP/2 gRPC fixture generated from the same official protocol. Results:

| Check | Result |
| --- | --- |
| Construct/save without gateway calls | Passed |
| Explicit non-default workspace on lifecycle and execution RPCs | Passed |
| Public health with invalid bearer | Healthy, authentication failed |
| Valid bearer and protected user/workspace access | Passed |
| mTLS certificate presentation | Observed |
| Untrusted server CA | Rejected |
| Exact output and terminal exit | Passed |
| Delete response and expected-ID wait | Original ID absent, replacement untouched |
| Worker shutdown during lost creation response | Child exited; durable unknown hold retained |

The fixture admitted two synthetic in-memory creations: one completed lifecycle and one interrupted creation. It ran one command stream and one deletion. No gateway, VM, provider account, project data or model allowance was used. This does not establish real gateway authorization policy, image readiness, compute behavior or cleanup semantics beyond the SDK/protocol fixture.

## Remaining gates

A live 0.1.6 HTTPS gateway, a dedicated workspace, a supported image and credentials entered in SLIM are needed. Install the optional official SDK and pass the read-only connection check; approve one temporary synthetic check before using compute. Retain output and deletion evidence. GitHub Packages artifact acceptance, real gateway/mTLS/OIDC authorization, resource lifecycle and operator recovery require that live check.

General chat execution is deliberately unavailable in this approved preview. The gateway's name-addressed delete/exec API has no atomic expected-ID precondition; dedicated workspace consent and conservative recovery reduce risk but do not prove concurrent replacement safety. There is no asserted sandbox TTL or egress enforcement in this integration. Details and source links are in [OpenShell setup and recovery](../OPENSHELL.md).
