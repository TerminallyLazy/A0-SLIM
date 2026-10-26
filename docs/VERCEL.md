# Vercel execution

Vercel code execution runs remotely and does not require a local Docker engine. SLIM’s native chat runtime and MCP remain in place. ACP agents manage their own execution environments.

## Setup

1. Save the Vercel team, project and token in **Environments**, then complete the synthetic connection test with its usage acknowledgment. Existing saved credentials are reused.
2. Under **Execution for new chats**, select **Vercel Sandbox · Node.js**. Approve code/input transfer and potential compute charges for the selected project.
3. Start a new native chat. Older chats retain their original execution setting. The header shows Vercel ready, working, permission needed, check needed, or needs review. Ready means a sandbox can start on a code call, not that a persistent VM is connected.
4. Use **Revoke Vercel usage** to block future calls. Changing saved credentials invalidates the connection test and grant; authorize the new connection and create a new chat. Revoking usage does not skip cleanup of a running call.

## Supported work and limits

`run_javascript` runs Node.js with explicit text input and returns output. SLIM does not automatically upload the project, inject model credentials, install packages, or provide a persistent shell/PTY. The agent can use its separately authorized read tools to include project text in the explicit input; the project grant covers that transfer to Vercel. Returned text can become a separately reviewed local artifact.

| Boundary | Setting |
| --- | --- |
| SDK / runtime | `@vercel/sandbox@3.9.0`, `node22` |
| Sandbox | One nonpersistent sandbox per call, 1 vCPU, 60-second lifetime |
| Network | Deny-all outbound policy; no published ports |
| Process | 10-second Node child, 128 MiB Node heap; provider command timeout 12 seconds |
| Payload | 32 KiB code; 64 KiB input; 64 KiB combined stdout/stderr |
| Transport | 2 MiB maximum response before SDK parsing |
| Usage | Three sandboxes per turn; ten across SLIM projects in ten minutes |

The Node heap limit is not a VM memory limit. Pricing and remaining allowance are determined by your Vercel account. [Vercel documents sandbox timeout and cleanup](https://vercel.com/docs/sandbox/working-with-sandbox), and [nonpersistent sandboxes](https://vercel.com/docs/sandbox/concepts/persistent-sandboxes) avoid automatic filesystem snapshots.

## Recovery

Receipts persist creation and command intent before requests leave the service. A duplicate call or identical code/input within the same owning turn returns its prior receipt; it does not create another sandbox. SDK mutation retries, automatic resume and fallback log streaming are blocked. Credentials, checks, execution and recovery share one provider lease.

Stop and service cancellation still attempt cleanup independently of the canceled command. Recovery verifies the original Vercel project, exact sandbox name and application/receipt tags, stops it, deletes it and verifies absence. A lost create or unconfirmed stop remains unknown and blocks new creation. A confirmed stop with incomplete deletion shows **stopped** and its cleanup error; **Recheck & clean up** retries cleanup only. An unexplained 404 does not prove deletion. The existing explicit provider-review path requires authenticated scope, the exact-name lookup and complete listing after the original lifetime. It preserves the failed execution outcome and never runs code.

## Acceptance

- The earlier real Vercel synthetic check passed, including artifact verification, stop and deletion. That check does not exercise native chat dispatch.
- Offline tests exercise the real native libfx chat/tool round trip with a local model and simulated Vercel peer while Docker methods fail if called. They cover permission/revision checks, lost creation/command/stop/deletion, cancellation, output bounds, persistent receipt budgets, duplicate suppression and SDK transport guards.
- Browser verification uses `tests/helpers/vercel-ui.ts`, isolated temporary data and local fixtures. Docker is unavailable; Vercel selection, explicit grant, native code call, deletion receipt and revocation are exercised without cloud traffic.
- Live native execution check passed on **2026-10-26 at 19:42:48–19:42:51 UTC**, after explicit owner approval for one sandbox. The updated app ran the native libfx tool call with the local test model and SDK 3.9.0, returned exit code 0 and exact output `A0 SLIM VERCEL EXECUTION CHECK\n42\n`, and confirmed stop, deletion and the subsequent exact-name 404. Exactly one native Vercel receipt was created; its final state is **passed / deleted**. The chat settled idle and the test project’s cloud grant was revoked afterward. No ChatGPT allowance or project file was used. This demonstrates the bounded Node.js path; live cancellation, billing totals and arbitrary workload support are not asserted.
- SPACE live server testing remains deferred until the owner has a server.

Local verification: `npm run check` passed **104 tests**, typecheck and production build; `npm audit --audit-level=high` found **0 vulnerabilities**. The live model helper is opt-in, emits at most one fixed tool request, and accepts at most two model requests. It is never run in CI.

Live output SHA-256: `9959767eea101eeed6592e157557c8b9bcc7c1b118ec2416f29a207f603e4dd8`. The test project’s revoked grant and deleted receipt were retained after restarting the final build; the local fixture servers were stopped.
