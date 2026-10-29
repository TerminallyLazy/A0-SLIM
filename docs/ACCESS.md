# Access and MCP

Choose an access mode from the dropdown beside the chat composer or in the project inspector. The selection is saved for that project. New projects default to **Approve for me**. Existing projects keep their previous permissions until a mode is selected; existing chats retain their original tool identities. Start a new chat once to use the updated tool set. Changing an access mode stops the current turn and cancels pending decisions.

| Mode | Behavior |
| --- | --- |
| Full Access | Unrestricted internet and file access within the signed-in OS account's permissions. Native host commands and MCP calls run without discretionary approval prompts. |
| Approve for me | Ordinary project text edits and bounded public-page reads proceed automatically. Sensitive paths, files outside the project, private network targets, URLs that may carry data, arbitrary host commands and opaque external tool calls ask for approval. |
| Ask for Approval | Ask before editing files on the computer (including project files), making internet tool requests, or running commands/tools with uncertain effects. Ordinary project reads and SLIM's own bookkeeping do not prompt. |

The evaluator uses host-owned action types, canonical destinations and arguments. It does not treat a tool name, remote description or MCP `readOnlyHint` as a safety guarantee. General MCP calls and arbitrary shell scripts currently have unknown effects and therefore ask in the two approval modes. Full Access is the explicit option for running them without those prompts. This initial evaluator does not attempt to classify arbitrary code with a model.

Native `fetch_url` fetches bounded HTTP(S) text, pins the evaluated DNS destination and evaluates each redirect. It sends no cookies or saved credentials. Private/reserved addresses, query strings and long URL paths require review in Approve for me. The bounds are 256 KiB, 15 seconds per request and four redirects. It does not run page scripts or implement a browser/search service. Configured model traffic and connection setup initiated directly by the user are not agent internet actions; they do not recursively request approval. Ask for Approval also reviews native Vercel execution requests before dispatch.

Full Access supports relative project paths, absolute paths and `~/` for native file tools, including hidden files. Symlinks are resolved to the destination shown in the decision; a changed destination invalidates a pending write. Regular text-file and output-size limits still apply. An explicit project folder under a tooling directory is treated as that project's boundary rather than making every file sensitive because of an ancestor's name.

## Approval in the conversation

A pending action displays its destination, reason, and expandable arguments or before/after preview. Choose **Approve once** or **Deny**. The same agent turn receives the result or denial and continues; another user message is unnecessary. Large inline previews are labeled as truncated; the full text remains available in Artifacts.

Approvals bind the owning chat/turn/call, action digest and project access revision. Duplicate approval clicks do not dispatch twice. Stop, changed permissions, disabled MCP tools and changed catalog definitions invalidate pending decisions. Restart cancels pending approvals. Previously uncertain file, shell or MCP effects keep their original recovery holds; an access mode never authorizes replay. File application preserves atomic receipts and rejects conflicting bytes or replaced paths.

## Connect an MCP server

Enter its URL or installed executable, arguments and credentials, then choose **Connect and enable**. SLIM connects, discovers the catalog and enables discovered tools by default. A successful connection shows its enabled-tool count. A failure stays saved as **Needs attention**, with **Retry connection**. Discovery only lists tools; it does not invoke them.

Tools are optional switches in a collapsed list. Refresh preserves explicit opt-outs and disabled servers, enables newly discovered tools, and invalidates pending calls when definitions change. Existing manually configured connections retain their tool selections. Each turn freezes its own catalog; tool revocation is checked again at dispatch. Large catalogs use compact server summaries and `mcp_tools` to retrieve tool descriptions/schemas on demand instead of inserting the whole catalog into the prompt. Existing catalog, frame, argument and response bounds still apply.

A local stdio server runs as a trusted OS-user process when connected. The form explains this before the single connect action. Access modes govern SLIM's tool requests; they do not sandbox independent work performed by that process. HTTP/Agent Zero tokens remain in the vault and token-bearing routes stay out of public connection metadata. The advanced **Run test** form explicitly invokes the exact user-entered tool call.

ACP agents retain their own execution settings. Full Access selects an offered `allow_once` option automatically; it never fabricates an option or chooses a persistent grant. Other modes show the agent's one-time request. Independent Agent Zero actions remain governed by Agent Zero. The UI states that external agent permissions also apply.

## Validation

On 2026-10-29, Node 24.22.1 passed all 176 repository tests, typecheck, production build and package smoke checks. The dependency audit reported zero vulnerabilities. The synthetic acceptance receipt is [access-acceptance.json](verification/access-acceptance.json).

`tests/access.test.ts` exercises the decision matrix, real temporary-file changes, external/hidden paths, symlink replacement, changed permissions, Stop, denied decisions, restart cancellation, automatic MCP setup, opt-out preservation, failed connections, compact large catalogs, bounded local HTTP reads and native libfx continuation. Native tests verify file, Bash and MCP calls under Full Access, automatic project edits, and one-time approval without a new message. Existing legacy chat/host-grant, native restart, cancellation, file atomicity and MCP unknown-effect tests remain intact. ACP tests verify that Full Access uses only a one-time option.

Chrome acceptance uses a synthetic model and local MCP/HTTP peers, not live model/provider accounts. It verifies all three selector states, automatic edit completion, inline approval followed by same-turn completion, automatic discovery/enablement and a preserved tool opt-out after refresh. Composer controls have matching 32 px selector heights and measured vertical centers within 0.01 px in the desktop capture. The UI/layout receipt is local; no private runtime database is committed.

These source changes do not imply a new public npm release. The existing release receipts and provider/plugin compatibility limits remain separate.
