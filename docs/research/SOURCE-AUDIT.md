# A0 SLIM source audit

Research date: **2026-10-26**. This is a documentation/source inspection, not a provider, sandbox, or application acceptance report. The revised specification contains product proposals derived from these findings.

## Evidence inventory

| Source | Verified observation | Consequence for Slim |
| --- | --- | --- |
| [libfx npm package](https://www.npmjs.com/package/libfx), downloaded `0.0.14` README, JS and declarations | Package version 0.0.14, API version 3, Node engine >=20; native backend plus WASM fallback. | Pin an exact version; do not confuse API version with package major. |
| [libfx Node guide](https://fx.sh/docs/lib/node) | Durable `createFxAgent` replaced the old in-memory constructor; `createFxEngine` is the lower-level engine. | Use durable sessions for app conversations. Native/WASM capabilities need platform tests. |
| Package README and `types/libfx.d.cts` | `messageId` deduplicates inputs; generated durable IDs, replay cursors, explicit cancellation; no host-tool `break_loop` field. | Design the coordinator around accepted messages and terminal results. |
| Package `custom-provider.js` | Custom providers target `/chat/completions`; HTTPS or loopback HTTP; supported model metadata is narrow. | Do not claim arbitrary protocol/header compatibility. Use dedicated adapters. |
| Package `chatgpt-sign-in.js` and `types/chatgpt.d.ts` | Codex-client login, manual callback or device code; account-dependent device flow. | This is a different path from current official OSS registration; package support alone is not product acceptance. |
| [OpenAI OSS overview](https://developers.openai.com/siwc/token-sharing-open-source) | Local/open-source app plan usage is documented separately from identity-only login; host identity and per-user/workspace registration matter. | Public local-first direction fits the documented integration category; actual eligibility still needs testing. |
| [OpenAI registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) | Dynamic registration, PKCE, state, nonce, issued client ID, ID-token validation and granted scopes. | Implement a dedicated account lifecycle; never borrow another client's token file. |
| [OpenAI inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) | Public Responses endpoint, account-specific catalog, streamed terminal outcome. | A model list or successful login is not a completed inference. |
| [OpenAI preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | Required request shape and unsupported fields/tools; local execution differs from hosted tools. | Validate the libfx protocol bridge early. Subscription access is not generic API-credit access. |
| [OpenAI app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) | Documents an alternative app-server configuration for the public flow. | Possible separately scoped fallback; adopting it changes runtime ownership and requires a recorded decision. |
| [Vercel Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference) via Vercel documentation connector | Create/execute/stop/snapshot operations and lifecycle-specific effects. | Make snapshot/pause/stop capabilities explicit; cleanup and receipts belong to the execution adapter. |
| [E2B lifecycle](https://docs.e2b.dev/sandbox) | Create/connect/pause/resume/kill, with timeout behavior. | Useful second implementation to test portability. |
| [Daytona stable sandbox docs](https://www.daytona.io/docs/en/sandboxes/) and [v2 alpha](https://www.daytona.io/docs/en/v2/sandboxes/) | Different API generations expose different lifecycle contracts. | Pin a supported generation; don't mix examples. |
| [Transformers.js custom models](https://huggingface.co/docs/transformers.js/custom_usage) | Local model location, remote-loading control, WASM assets and ONNX conversion. | Separate artifact download from runtime; offline requires both model and runtime assets. |
| [Transformers.js Node tutorial](https://huggingface.co/docs/transformers.js/tutorials/node) | Node inference and filesystem cache guidance. | Prefer Node worker-based durable local embedding support; validate chosen package/model pins at P0/P2. |
| [Hugging Face hosted chat](https://huggingface.co/docs/inference-providers/tasks/chat-completion) | Hosted inference is a separate service from the Hub model files. | Provide distinct hosted and local paths; don't label a model download as a provider connection. |
| [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai) | Documented OpenAI-compatible API with a Gemini key. | Add a compatible provider preset, then validate model-specific tools/streaming. |
| [Node release schedule](https://nodejs.org/en/about/previous-releases) | Node 24 is LTS; Node 20 is EOL at research time. | Proposed runtime baseline is Node 24. |
| [Agent Zero Plugin Index README](https://github.com/agent0ai/a0-plugins/blob/main/README.md), fetched through GitHub connector | Index metadata points to repos with `plugin.yaml`; allowed index fields are limited; publication recovery behavior is documented. | Keep Slim compatibility metadata separate and retain the last usable catalog. |

During the initial research phase, no provider credentials were read and no billable inference, sandbox creation, plugin installation or model download was performed. The npm package was inspected in a temporary research directory without installing/executing it. Documentation can drift; recheck the adopted versions before implementation.

## Agent Zero source findings

Reference checkout: `agent0ai/agent-zero` lineage, branch `main`, inspected HEAD `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`. The checkout has unrelated untracked files; none was edited. `git log --all` encountered a malformed local `refs/heads/main 2`, so history review was restricted to the valid HEAD ancestry. No repair or history fetch was attempted. This limits evidence to the locally available ancestry.

- `extensions/python/system_prompt/_11_tools_prompt.py` collects named tool prompt files and filters them through tool policy. Tool documentation and callable capability need to agree.
- `plugins/AGENTS.md` defines Python hooks, framework APIs and Alpine WebUI extensions. These are incompatible execution surfaces with a standalone Node app unless adapted.
- `plugins/_plugin_installer/helpers/install.py:359` reads the generated-index release asset at `https://github.com/agent0ai/a0-plugins/releases/download/generated-index/index.json`.
- `plugins/_oauth/README.md` and `AGENTS.md` separate account providers from API keys and require plugin-owned credential files, safe error handling and reconnect state. They are useful architectural references, not a reason to copy an older authentication flow.
- Existing Agent Zero memory/prompt excerpts in the user-supplied preliminary document are conceptual references. Slim will not import Python modules, FAISS serialization or raw Agent Zero WebUI HTML.

## frdel review: partly aligned, with concrete improvements

The original independent tool-oriented design fits several observed Agent Zero patterns. The original startup-only prompt and simplistic plugin/recovery handling need refinement. The following are inspected diffs, not claims about a maintainer's personality:

| Observed commit | Concrete diff evidence | Inference for Slim | Confidence |
| --- | --- | --- | --- |
| [`89d4b891`](https://github.com/agent0ai/agent-zero/commit/89d4b8913f400d92ac00e4d143c17d3e76ad9f25) | Consolidates module-loading helpers; selectively refreshes plugin namespaces on Python changes; introduces pre-update hook. | Keep shared lifecycle primitives small and owned; changes invalidate affected capabilities, and update has a preparatory/rollback boundary. | Medium: direct plugin lifecycle precedent. |
| [`c7a98363`](https://github.com/agent0ai/agent-zero/commit/c7a983638eead8068b69ba456715d5be04e6df8f) | Hub requests carry a sequence; stale responses cannot replace current state; refresh is explicit. | Use observable connection/catalog state and stale-response protection in provider and Hub screens. | High for this specific race-handling behavior. |
| [`15a2b553`](https://github.com/agent0ai/agent-zero/commit/15a2b553beaa037d3617cee3caa0ba9e27aad509) | Model override API reports configured/effective presets and emits embedding-change notifications after comparison. | Separate reusable preset definitions, effective turn settings and embedding invalidation. | High for the observed contract, medium for cross-language design inference. |

Polish applied to the proposed spec: explicit registries, scoped settings, per-turn capability snapshots, plugin lifecycle ownership, durable operation receipts, and catalog request ordering. No Agent Zero source changes were made. This is not a maintainer endorsement or a completed code review of an application.

## Preserved inputs and logo provenance

| File | SHA-256 |
| --- | --- |
| `docs/original/A0-SLIM-SPEC.md` | `0d203b80a6be6173684bd238c399338a8326ec61d5246eec29f675571f3d9d84` |
| `docs/review/assets/a0-symbol-dark.svg` from `docs/res/a0-vector-graphics/darkSymbol.svg` | `59590ca4b7feeedf6c0502bc90db8a16244d461ab6194a253cad8b44d09e70fe` |
| `docs/review/assets/a0-symbol-light.svg` from `docs/res/a0-vector-graphics/lightSymbol.svg` | `09f9aa0e24004f50ea5364eee90511c73b588db0afc7ba0de3679acf6617456f` |

The original document at its user-provided location was not changed. The copied symbols are unchanged. Upstream attribution is in `THIRD_PARTY_NOTICES.md`; the original MIT notice is retained. No logo generation was used.

## Planning verification boundary

Repository publication, document integrity, links and prototype rendering are checkable now. Live model access, OAuth consent/refresh, real sandbox cleanup, native/WASM packaging, plugin execution and performance budgets are implementation gates. Do not turn “documented” into “tested.”


## Implementation addendum — 2026-10-26

The owner subsequently authorized implementation and connected ChatGPT in the app. The [alpha evidence](../verification/P1.md) records synthetic-only project data used with that live subscription, approved artifact bytes, restored conversations, and real local Docker cleanup. No account identity, token, protocol ciphertext or private transcript is published here. No cloud sandbox has been created during these checks.

| Current primary source | Applied finding |
| --- | --- |
| [OpenAI stateless reasoning](https://developers.openai.com/api/docs/guides/reasoning) | Current stateless output includes encrypted reasoning by default. Preserve completed provider items; do not reduce them to visible text. Live reasoning-bearing acceptance remains separate. |
| [OpenAI preview contract](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | Keep HTTP stateless, use explicit history, avoid unsupported parameters and hosted tools. |
| [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing) | Hobby monthly allowances include 5 CPU hours, 420 GB-hours memory and 5,000 creations. Hobby quota pauses new creation; paid plans can incur usage. |
| [Modal pricing](https://modal.com/pricing) | Starter includes $30 monthly compute credit; do not equate an account plan with remaining free usage. |
| [Modal Sandboxes](https://modal.com/docs/guide/sandboxes), [JS Sandbox API](https://modal.com/docs/sdk/js/latest/Sandbox), [network controls](https://modal.com/docs/guide/sandbox-networking) | Pinned npm `modal@0.11.1`; name/tags, blocked networking, no mounts/secrets/identity token, bounded TTL and explicit termination. Local package types and implementation were inspected before integration. |
| [E2B pricing](https://e2b.dev/pricing), [Daytona pricing](https://www.daytona.io/pricing) | $100 one-time E2B credit and $200 introductory Daytona compute are trial offers; no recurring free allowance is asserted for these adapters. |

Native libfx restoration inserts a file-evidence note that was absent from the original provider requests. The bridge preserves that exact, file-call-backed metadata as supplemental user context while replaying the completed provider history. This is a locally observed behavior with a native regression test, not a documented broad guarantee for future libfx versions. The native package remains pinned.


## Additional provider audit — 2026-10-26

Primary documentation and installed SDK implementation were checked together:

- [E2B lifecycle](https://docs.e2b.dev/sandbox), [quickstart/API keys](https://docs.e2b.dev/quickstart), and [pricing](https://e2b.dev/pricing): `e2b@2.59.0` exposes kill-on-timeout, no auto-resume, metadata filtering across running/paused sandboxes, and explicit network controls. API-key setup links to `https://console.e2b.dev/?tab=keys`. The deprecated sandbox URL override remains independent of the API endpoint; the app rejects it before requests.
- [Daytona stable TypeScript API](https://www.daytona.io/docs/en/typescript-sdk/daytona/), [sandbox lifecycle](https://www.daytona.io/docs/en/typescript-sdk/sandbox/), [API key scopes](https://www.daytona.io/docs/en/api-keys/) and [pricing](https://www.daytona.io/pricing): pin `@daytonaio/sdk@0.226.1`, separate from v2 alpha; request `write:sandboxes` and `delete:sandboxes`, a wall-clock TTL and immediate deletion after stop. Source inspection verified endpoint/auth precedence, request deadlines, create retry restrictions and the tracing-flag fallback described in the decision log.
- Official logo provenance is recorded in [the notices](../../THIRD_PARTY_NOTICES.md) and `ui/public/providers/sources.json`. Assets are served locally with no external image fetch. Official account, dashboard, credentials, help and pricing links live in `ui/sandbox-providers.ts`.

These are source and synthetic contract checks. They do not prove account eligibility, an available credit balance or live cloud cleanup.

### Owner-provided Vercel quickstarts

The supplied TypeScript and Python quickstarts were reviewed against the current [quickstart](https://vercel.com/docs/sandbox/quickstart), [authentication guide](https://vercel.com/docs/sandbox/concepts/authentication), [JS SDK](https://vercel.com/docs/sandbox/sdk-reference), and [Python SDK](https://vercel.com/docs/sandbox/python-sdk-reference). Their account/project/resource identifiers are deliberately omitted from public documentation.

The examples demonstrate CLI OIDC authentication with a 12-hour local token and persistent named sandbox reuse. The local alpha uses the documented explicit access-token/team/project option. Its synthetic check intentionally creates a unique, nonpersistent, tagged sandbox with a 60-second timeout and deny-all networking, then stops it in `finally`; this avoids automatic snapshot storage for a one-off check. The TypeScript SDK already executes the remote Node workload, so a Python SDK installation is not required by this application. An integrated CLI OIDC onboarding flow and persistent cloud agent sessions remain future capabilities. The supplied quickstart was reviewed, not run; no output or live acceptance is claimed from it.

### Additional Agent Zero artwork

The owner supplied `docs/res/dark.svg`, `docs/res/a0-vector-graphics/horizontal_banner.svg`, `banner.svg` and `a0LogoVector.ai` from the reference checkout. All four are retained byte-for-byte in [the brand source folder](../brand/agent-zero/README.md), with hashes in its manifest. The original horizontal banner is used in Appearance as an attribution image; compact navigation retains the original symbol-only marks. No source artwork was recolored, redrawn or modified.

## P2 source checks — 2026-10-26

- **Plugin Hub:** the actual endpoint is [generated release index.json](https://github.com/agent0ai/a0-plugins/releases/download/generated-index/index.json). Live read returned 218 entries. Three entries lacked a pinned commit and one had null tags; the parser preserves these as unknown rather than fabricating revisions or rejecting the entire catalog. Source assessment uses GitHub's recursive tree at the catalog commit and never executes code.
- **Portable skill proof:** `vanja-emichi/a0_agent_skills` at `239ffe10531eed627e66d4a789c287318aafb78c` contains Agent Zero/Python surfaces, so the full plugin requires Agent Zero. `skills/api-and-interface-design/SKILL.md` at that exact commit parsed, imported disabled, enabled and loaded through Slim's instruction loader. Its recorded digest is `ea6463d63cc06be15e4e134e3930fa02cba19e16c213602e2a01aabc803e130d`. This proves only the individual Markdown route, not plugin parity or every instruction's executability.
- **MCP:** official [TypeScript SDK 1.32.2 client documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/docs/client.md), [protocol documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/1.32.2/docs/protocol.md), and installed `libfx/mcp` adapter source. Keep transports/credentials/lifecycle with the host, use bounded catalog pagination, and distrust remote annotations. SDK 1.x matches libfx 0.0.14's host-client adapter contract; this is a deliberate pin, not a claim that v1 is the newest SDK family.
- **Agent Zero bridge:** read-only source inspection of its current `helpers/mcp_server.py` and `webui/components/settings/mcp/server/example.html` showed Streamable HTTP at `/mcp/t-{token}/http`, optionally `/p-{project}`. The preset encrypts the token and builds the path server-side. Protocol and custody tests use a synthetic endpoint; a real owner instance is a separate gate.
- **Local embeddings:** official [Transformers.js model loading](https://huggingface.co/docs/transformers.js/custom_usage) and [source](https://github.com/huggingface/transformers.js) plus Hub API metadata for [Xenova/all-MiniLM-L6-v2 at the pinned revision](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9). The quantized ONNX file is 22,972,370 bytes; model/tokenizer files together are 23,685,172 bytes. Download checksum verification and local-only 384-dimensional CPU inference passed with `@huggingface/transformers` 4.3.1. The worker rejects network fetches. No browser/WASM offline acceptance is claimed.
- **Performance:** Apple M4 Pro, Node 24.22.1, 10,000 generated notes and 100 lexical searches: measured p95 8.58–9.27 ms in two runs. This is FTS retrieval, excluding embedding generation, API/UI overhead and real-project variability. It is not a semantic retrieval benchmark.


### Subordinates and Markdown — 2026-10-26

- Read-only Agent Zero reference `tools/call_subordinate.py` at `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`: child context persistence, superior binding, shared project, `context_id` continuation and cancellation. Slim implements a bounded read-only subset with the same vocabulary; no profile/model-override parity claim.
- Installed libfx 0.0.14 `durable.js`: cancel is a durable message; opening a session is not a resume. A forced worker termination exposed an abandoned child turn blocking fresh continuation; explicit cancellation before the continuation resolves it without replacing the child mapping. Regression lives in `tests/delegation.test.ts`.
- [react-markdown](https://github.com/remarkjs/react-markdown) and [remark-gfm](https://github.com/remarkjs/remark-gfm): AST rendering, component overrides and GFM support. Pinned versions 10.1.0 / 4.0.1; raw HTML disabled, safe links, no automatic external image requests.
