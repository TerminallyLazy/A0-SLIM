# Agent Zero behavior in A0 SLIM

The goal is to preserve useful Agent Zero workflows, not only its artwork. This is an independent implementation, not a drop-in replacement for Agent Zero's Python runtime.

| Agent Zero workflow | Delivered Slim behavior | Boundary |
| --- | --- | --- |
| Repeated tool use to complete a task | Native libfx loop, scoped files, staged writes, bounded Docker or Vercel Node.js computation | No unrestricted host shell or persistent cloud workspace; one native Vercel calculation passed with verified deletion. [Execution scope](VERCEL.md). |
| Load skills when relevant | Enabled project catalog in each turn; `skills_tool` loads exact reviewed revision | Markdown instructions only; no implicit script/resource installation. |
| Recall and improve project knowledge | Automatic lexical recall when enabled; `memory_load`, `memory_save`, `memory_delete`; main/fragments/solutions | Explicit project read/write grants; no silent whole-chat ingestion. |
| Semantic retrieval | Optional pinned local MiniLM, independent compatible embedding connections, hybrid rank fusion | Hosted transmission needs consent; no FAISS index compatibility claim. |
| MCP tool access | HTTP and trusted stdio discovery; tool allowlist; `mcp_call` proposals and `mcp_result` | Exact approval per call, not unrestricted autonomous remote execution; no OAuth or MCP Apps yet. |
| Python plugins and framework hooks | Whole-agent ACP connection; optional MCP tools in native SLIM chats | The plugin, Python runtime, data and authority remain on Agent Zero. No remote plugin installer or native UI emulation. Real instance acceptance pending. |
| Community plugin discovery | Actual generated catalog, pinned tree assessment, review of individual portable skills | A known name or a valid manifest is not proof of compatibility. Entries without commits remain unknown. |
| Persistent context and recovery | Durable chats, tool receipts, per-turn snapshots, stopped/unknown states and reconciliation | Old chats keep original runtime identities; start a new chat for P2 tools. |
| Subordinate agents | `call_subordinate`, separate persisted child context, parent/result link, `context_id` continuation, two levels, cancellation tree | Read-only research/review; same model/project, inherited skill/recall grants, shared request budget. No child execution/MCP/writes, profile overrides or general automation. One owner-authorized ChatGPT subordinate task passed; see P2 verification. |

The reference checkout was inspected read-only, including `helpers/skills.py`, `plugins/_memory/api/memory_dashboard.py`, `plugins/_plugin_installer/helpers/install.py`, `helpers/mcp_server.py`, `tools/call_subordinate.py`, and the skills/MCP UI. Its HEAD during inspection was `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`. In particular, the MCP example exposes a project-scoped `/mcp/t-{token}/p-{project}/http` route; Slim constructs that route only in the authenticated server-side transport. Public connection metadata contains the base URL, never that token-bearing route.

A0 SLIM's system instructions describe its actual tools, permission boundary, and limitations. Plugin metadata, recalled notes, files and tool results are source material, not authorization. Enabling a skill changes task guidance; granting an MCP tool permits proposals; approving exact arguments authorizes one external call.

ACP uses the pinned TypeScript SDK 2.0.2 stable v1 interface. The inspected reference includes `plugins/_a0_acp` version 2.0 and the A0 CLI connector. Agent Zero retains its own prompt loop, plugins, memory, model settings and authority. Native SLIM tools and memory are not injected into external sessions. Read the [ACP setup and acceptance record](ACP.md); a generic protocol fixture is not proof that every Agent Zero plugin or other ACP agent is compatible.
