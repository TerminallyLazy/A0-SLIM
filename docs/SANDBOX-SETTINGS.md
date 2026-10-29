# Sandbox settings

In **Environments**, choose **Session timeout (minutes)**, **vCPUs** and **Memory**, then **Save sandbox settings**. Credentials are saved separately. Defaults use a 15-minute maximum lifetime. A completed call still cleans up immediately; this setting does not create a persistent shell or extend the separate Node/Bash command deadline.

| Provider | vCPUs | Memory | Session timeout |
| --- | --- | --- | --- |
| Vercel Hobby | 1, 2, 4 | 2 GB per vCPU; linked selectors | Default 15, maximum 45 minutes |
| Modal Starter | 0.25, 0.5, 1, 2 | 128–2048 MiB | Default 15, maximum 60 minutes |
| E2B Hobby base template | 2; fixed | 4 GiB; fixed | Default 15, maximum 60 minutes |
| Daytona entry tier | 1, 2, 4 | 1, 2, 4 GiB | Default 15, maximum 60 minutes |
| Local Microsandbox | 1, 2, 4 | 512 MiB, 1, 2, 4 GiB | Default 15, maximum 60 minutes |
| Local Docker | 0.5, 1, 2, 4 | 128–2048 MiB | No independent session; ends with command |

These are conservative choices available within entry plans, not a guarantee of remaining free usage. Vercel Hobby pauses creation at its quota; paid accounts have their own billing. Modal, E2B and Daytona use shared or introductory credit. Check the provider dashboard before use. SLIM does not read account balances, upgrade accounts or purchase credits. E2B custom CPU/memory requires Pro and is not exposed. GPUs and paid-only larger shapes are unavailable.

Modal uses physical CPU cores, so SLIM converts two vCPUs to one physical core and sets the CPU/memory limits equal to the selected requests. Daytona uses a private `python:3.13-slim` image with 3 GiB disk; its pinned SDK requires image creation for custom resources. The existing network, credential, ownership and cleanup boundaries remain in force.

Changed settings require a fresh provider check. For Vercel, renew the project grant and start a new chat. Microsandbox also requires a fresh check/new chat; Docker uses the saved size on subsequent calls. Updates are blocked during active provider work. Receipts retain the size and lifetime used at creation; reducing the current timeout cannot release an older unknown sandbox early. Updating the Microsandbox worker requires explicitly refreshing the installed add-on, with old-worker recovery preserved.

Sources checked October 28–29, 2026: [Vercel pricing](https://vercel.com/docs/sandbox/pricing), [Vercel resources](https://vercel.com/sandbox), [Modal resources](https://modal.com/docs/guide/sandbox-resources), [Modal pricing](https://modal.com/pricing), [E2B pricing](https://e2b.dev/pricing), [Daytona limits](https://www.daytona.io/docs/en/limits/), [Daytona pricing](https://www.daytona.io/pricing). Provider terms and available balances can change.

## Verification — 2026-10-29

Node 24 passed 153 repository tests, typecheck and production build. Tests cover default/invalid sizes, selected SDK options, Vercel grant invalidation, Microsandbox old-chat blocking, active-operation locking and recovery using original lifetimes. Package smoke passed; dependency audit found zero vulnerabilities. Chrome verified persistent settings, Vercel CPU/memory coupling, fixed E2B controls and narrow-layout overflow.

The updated Microsandbox 0.7.11 worker passed live Apple Silicon execution: native-chat round trip, isolated host data/credentials, denied guest network, code/output limits, cancellation, interrupted-worker recovery and all six sandbox receipts deleted. The live test uses a synthetic model. New cloud resource choices were verified against SDK contracts and test doubles; this change did not consume cloud compute or establish remaining account credit.
