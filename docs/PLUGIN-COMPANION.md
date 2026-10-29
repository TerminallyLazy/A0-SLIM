# Agent Zero plugin compatibility

SLIM supports three routes: ACP for a whole Agent Zero session, an optional MCP
companion for selected plugin tools in native chats, and reviewed skill imports.
Agent Zero UI, memory hooks and scheduled services need their original host or an
explicit native port. The Hub records those capabilities separately at an exact
source revision. Source assessment is distinct from runtime verification.

Agent Zero's built-in MCP server exposes `send_message` and `finish_chat`. It
delegates work to the remote agent; it does not enumerate every plugin tool.
Approving `send_message` authorizes that task, not separate SLIM approval for each
internal remote action. The existing token remains in SLIM's vault.

## DB Hub companion preview

The separately packaged [companion](../integrations/agent-zero-tools/README.md)
exports DB Hub 1.0.0 status/schema operations against existing local SQLite files
using SQLAlchemy on pinned Agent Zero 2.14. Native SLIM keeps its own model,
conversation and memory. The Python tools execute on the selected host.

The implementation uses standard MCP stdio and an explicit metadata contract
for durable operation IDs and compatibility fingerprints. Installation is manual
on a dedicated host; there is no automatic Hub installer, HTTP listener, provider
credential transfer, schema migration, model request or native Python runner.
SLIM's core npm dependency graph does not include Agent Zero or Python.

Follow the companion README for setup, binding, discovery, grants and recovery.
The bridge is full-trust host execution. A per-tool grant constrains requests and
does not isolate arbitrary Python code. Database query/write operations and other
database drivers remain unexported until separately validated.

## Hub behavior

Assess a pinned entry to see its tools, skills, lifecycle and UI requirements.
The independent SLIM overlay checks repository identity as well as commit.
Repository/pin changes and assessment format changes invalidate stale records.
Incomplete trees make no compatibility claim. Instruction imports warn that
referenced files, scripts and Agent Zero tool names are not imported.

“Use in Agent Zero” opens the existing agent connection workflow; select a
connection and start a separate external chat. It does not silently migrate a
native chat or install a plugin. “Connect companion tools” opens Skills & MCP;
install and review the explicit stdio command before discovery. Original plugin
settings remain in the authenticated Agent Zero WebUI at its own origin.

See [verification](verification/PLUGIN-COMPANION.md) for the exact tested stack,
real-plugin versus synthetic evidence, and open owner-account/UI gates.
