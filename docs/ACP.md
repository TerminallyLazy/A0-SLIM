# External agents over ACP

SLIM supports two chat backends. Native chats keep libfx, SLIM tools, skills, memory, model connections and MCP. ACP chats use a separately installed agent and its own runtime. Choose the backend in the new-chat model/agent selector before sending; an existing chat keeps its backend.

## Agent Zero setup

1. Install the [A0 CLI](https://github.com/agent0ai/agent-zero/blob/development/docs/guides/a0-cli-connector.md), configure your Agent Zero instance and complete its normal CLI sign-in. Find the executable with `command -v a0`. SLIM does not install agents or copy credentials from another application.
2. Review Agent Zero's ACP settings, especially host file access and command execution. The inspected connector executes these operations through its own tools; disabling SLIM's file/terminal capabilities does not disable those tools.
3. In **Agents**, choose Agent Zero, enter the absolute executable path and an optional instance URL, and acknowledge host trust. Leave the URL blank to use the CLI’s saved instance or local Docker discovery. The preset uses `a0 acp [--host <url>] --transport connector`. No credentials belong in the URL or arguments. Optionally permit SLIM's project-text read callback.
4. **Check connection** launches the connector in a temporary folder, sends ACP initialization, displays the agent/version and closes the connector. It sends no session or prompt. Successful initialization does not verify instance authentication or model inference.
5. In a new chat, choose a project and the saved Agent Zero connection. Send a bounded task when ready to use that agent's account. Agent Zero owns its model selection, tools, plugins, memory and execution. The header distinguishes a live local ACP connection from a disconnected session; it does not claim that a sandbox is active.

For another agent, choose **Other ACP agent** and supply its absolute executable and JSON argument array. Use its official ACP launch instructions and sign-in. The protocol is generic; agent-specific compatibility requires a separate check. Profiles are immutable; save a replacement when the command or arguments change. Disable stops owned active chats and disconnects their local processes; saved history remains.

## Permissions and recovery

ACP agents are trusted local executables running as your OS user. The child receives HOME, PATH, temporary-directory and locale variables, not SLIM's model keys or arbitrary inherited environment variables. Its own credential files remain accessible to it. A working directory and ACP capabilities are not OS isolation.

SLIM advertises no terminal or file-write callbacks. Optional project-text reads use canonical-root, sensitive-path, symlink, regular-file and size checks. An agent's own tools are governed by that agent. If it requests a client permission, SLIM shows the request and supports only offered one-time allow/reject options. No persistent grant is silently substituted. The exact request digest, chat/session/turn and decision are retained locally; pending decisions expire on service restart. Stop/disconnect cancels pending requests. The UI cannot promise permission prompts for agents that do not request them.

Prompt intent and message hashes are persisted before dispatch. Duplicate requests do not resend. Browser reconnect reads the local transcript without launching an agent. On the next explicit message, an existing remote session is loaded if the agent supports it; otherwise the user must start a new chat. The initial preview suppresses replayed history during load and does not synchronize edits made in another client. It streams text/Markdown, tool activity and plans; attachments and richer content are not yet supported.

**Stop** cancels pending permission requests, sends `session/cancel` and waits for the prompt response. If the agent disconnects or does not confirm Stop, SLIM kills its owned local connector and records **External outcome unknown**. The remote task may still be running. Check the external agent, stop any continuing work, and record the result in **Agents** before sending further ACP tasks. This hold applies across ACP profiles; the original receipt remains. No prompt is retried automatically. SLIM never calls `session/close` for cleanup because the inspected Agent Zero implementation removes that remote chat.

Client limits: 8 connections, 32 pending permissions, 1 MiB protocol frames, 2 MiB or 10,000 updates per turn, 10-minute turns, bounded initialization/session/Stop waits. External agent model usage and remote job duration are not bounded by SLIM's native request budgets. Agent executables and their dependencies are not sandboxed or frozen by saving a profile.

## Current compatibility and evidence

- Pinned `@agentclientprotocol/sdk@2.0.2`, default stable ACP v1 interface and stdio transport. [SDK](https://github.com/agentclientprotocol/typescript-sdk), [initialization](https://agentclientprotocol.com/protocol/v1/initialization), [cancellation](https://agentclientprotocol.com/protocol/v1/cancellation).
- Agent Zero source inspected read-only at `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`: bundled `_a0_acp` plugin version 2.0; installed CLI's `agent_zero_cli/acp.py`. It exposes whole-agent sessions and retains Agent Zero's existing runtime.
- Independent stdio fixture tests exercise actual SDK transport, prompt/session mapping, cursor history, duplicate-ID checks, exact permission decisions, Stop, unknown outcomes, load capability refusal, client-file boundaries and API authentication. These tests do not make live provider requests.
- Installed Agent Zero CLI **2.14** passed initialization on 2026-10-26 at 17:59:46 UTC: protocol v1, `loadSession: true`, agent identity `agent-zero`. The connector was closed without sending `session/new` or `session/prompt`. This does not establish authenticated runtime access.
- Real Agent Zero task quality, authentication/session reload against the owner instance, actual plugin behavior and a second coding agent require separate live acceptance. No general compatibility claim follows from a handshake.

Deferred: ACP HTTP transport, interactive protocol authentication, model/mode selection, attachments, persistent grants, client terminal/write services, sharing SLIM MCP servers or memory with an external agent, and using ACP agents as native subordinates. Agent Zero MCP tools remain available separately in **Skills & MCP**.

Live task attempt on 2026-10-26 stopped before prompt dispatch: local discovery found the owner instance, which reported `auth_required: true`; the CLI session verification returned false. No remote session ID or model output was returned, and the synthetic file remained unchanged. Owner CLI sign-in is required before the already-authorized single task can proceed. The handshake alone did not detect this authentication requirement.

## Owner-host task acceptance — 2026-10-29

The earlier sign-in gate is closed. The saved session used the exact `localhost` host alias. On pinned Agent Zero 2.14 with CLI 2.14, a synthetic project with a read-only SQLite connection completed a real-model DB Hub status/schema task and another schema task after SLIM restart/reload. Both ended normally; the database hash was unchanged. The journal preserves text exactly as received. For this exact CLI version, SLIM renders its cumulative assistant updates as snapshots; other agents/versions keep standard ACP chunk semantics. See [the scoped acceptance receipt](verification/plugin-hub-owner-acceptance.json).
