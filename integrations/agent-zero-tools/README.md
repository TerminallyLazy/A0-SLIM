# SLIM tool companion

An optional stdio MCP companion for **Agent Zero 2.14** at commit
`ff2a5b9c9c4e490ba38dd7c313e779510bb2071a` and **DB Hub 1.0.0** at
`9f3b9926cdd815034b0f9f635c60909107d1f2da`. It exports `a0_db_hub_db_status`
and `a0_db_hub_db_schema` against explicitly bound, existing local SQLite
databases through DB Hub's SQLAlchemy driver. Other drivers, query/write tools,
memory replacement, agents, scheduler and UI contributions are outside this preview.

This package requires a dedicated Agent Zero host, its framework Python runtime,
the MCP Python SDK, and SQLAlchemy. It has no installation/startup hook and opens
no HTTP port. It uses the real DB Hub tools and Agent Zero policy, intervention,
before/after hooks, history and secret masking. Its source pin manifest fails
closed on changed framework/plugin source and executable overrides.

Copy the reviewed package into `usr/plugins/slim_tools_bridge/`, with DB Hub
installed separately at the exact supported revision. Use the project's scoped
DB Hub settings to configure an existing SQLite file with `readonly: true`.
Keep DB Hub memory replacement off. Disable `_infection_check`,
`_telegram_integration`, `_whatsapp_integration` and `_email_integration` in this
dedicated host: they add agent/network lifecycle behavior beyond this adapter.
Keep `_tool_access` active. Do not apply these setup changes to a general-purpose
Agent Zero instance just to try the companion.

Create an explicit binding file on that host:

```json
{
  "project": "my-project",
  "profile": "default",
  "connections": ["my-sqlite-connection"],
  "enabled": true
}
```

From the Agent Zero root, run its framework Python:

```sh
/opt/venv-a0/bin/python -m usr.plugins.slim_tools_bridge.server --binding /absolute/path/binding.json
```

In SLIM, add a trusted **stdio** MCP connection. For a Docker host, select the
installed Docker executable and arguments `exec`, `-i`, `-w`, the Agent Zero root,
the container name, framework Python, `-m`, `usr.plugins.slim_tools_bridge.server`,
`--binding`, and the absolute binding path. Do not use a shell command string.
Discover, grant only the desired tools, and enable. Use a new native chat, review
the staged operation in Approvals, then send a follow-up message to retrieve it.

The MCP catalog contains a versioned compatibility fingerprint and stable host
scope. SLIM supplies a persisted operation ID and expected fingerprint in
`_meta["io.a0-slim/operation"]`; ordinary callers must implement this contract.
The model does not choose those fields. Host/config changes require reconnect,
rediscovery and new approval. A tool's successful execution is not proof that
its result reports database health: inspect the returned plugin result.

Receipts and installation identity live under `usr/slim-tools-bridge/`.
Per-project/profile SQLite journals and OS process locks prevent duplicate
dispatch. A process exit, timeout or lost outcome leaves an unknown hold. No
exactly-once side-effect guarantee is made. Keep this directory across upgrades;
deleting it discards recovery evidence. Do not clone its installation identity
into independent hosts.

Inspect and reconcile on the original host, even when the binding is disabled:

```sh
/opt/venv-a0/bin/python -m usr.plugins.slim_tools_bridge.server --binding /absolute/path/binding.json --inspect OPERATION_UUID
/opt/venv-a0/bin/python -m usr.plugins.slim_tools_bridge.server --binding /absolute/path/binding.json --resolve OPERATION_UUID --reason 'Describe the independently checked outcome here.'
```

Resolve the corresponding SLIM hold after reviewing the host receipt. Changing
connection URLs/command aliases cannot clear a discovered companion scope hold.
Disabling SLIM or the host binding prevents new work; killing Docker's local
connector does not prove the Python operation stopped. Inspect before removal.
To uninstall, stop owned companion processes, remove this plugin package, and
keep its receipts by default. Remove plugin-owned data only after reconciliation.

This is trusted host code, not a per-plugin sandbox. Protect host credentials
and constrain filesystem/network access externally. Pins detect source drift;
they do not defend against a malicious process with the same OS authority.

Build the reviewed ZIP from the SLIM repository with
`python3 scripts/package-plugin-companion.py --output /tmp/slim-tools-bridge.zip`.
The ZIP contains only the eight reviewed source/manifest/license files, never
configuration, databases, credentials or upstream runtime dependencies.

See the SLIM repository's `docs/PLUGIN-COMPANION.md` and
`docs/verification/PLUGIN-COMPANION.md` for evidence and remaining gates.
