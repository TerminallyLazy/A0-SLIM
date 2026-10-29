# Hub plugins in native SLIM

The optional SLIM plugin worker runs supported, pinned Agent Zero Hub tools in
native SLIM chats. It does **not require an Agent Zero installation**, a second
agent/model, Docker, or a system Python installation. Existing ACP and the
full-host companion remain separate optional routes.

## DB Hub preview

1. Choose a project, open Plugin Hub, refresh and assess **Database Hub**.
2. In **Use DB Hub in SLIM**, review the optional download and install support.
3. Enter the relative path to an existing SQLite file in this project.
4. Review local process access and enable the tools.
5. In a native chat, ask for database status or schema. The project's selected
   access mode governs the MCP call. Disable the tools from the same Hub panel.

Worker 0.1.0 executes DB Hub 1.0.0 at
`9f3b9926cdd815034b0f9f635c60909107d1f2da`: `db_status` and `db_schema`, using
SQLAlchemy 2.0.52. The model sees `db_hub_status` and `db_hub_schema`; the database
path is selected by the owner in setup, never supplied by a model tool argument.
SQLite opens with `mode=ro`. Symlinks and protected project paths are refused.
Queries/writes, other drivers, memory replacement, scheduler hooks and original
Agent Zero screens are not included. The Hub shows setup only for the supported
repository and exact revision; browsing never runs plugin code or install hooks.

## Runtime and source custody

On macOS arm64/x64 and glibc Linux arm64/x64, SLIM downloads Python 3.12.16 from
the immutable python-build-standalone 20261026 release (about 25–35 MB compressed),
four pinned wheel dependencies, and eleven checksum-verified DB Hub source and
license files. Downloads are opt-in. Other platforms report unsupported.
Windows and musl Linux acceptance are not claimed.

Runtime pins, wheel hashes and the source recipe ship in `addons/plugin-worker`.
The original tool/driver/helper files execute unchanged. A small compatibility
module supplies scoped configuration, project identity, cooperative cancellation,
the Tool/Response types and credential-free SQLite secret handling. It does not
import `agent.py`, emulate arbitrary hooks, or load the user's Agent Zero state.
Unknown APIs and secret placeholders fail instead of silently inheriting access.

The worker communicates over MCP stdio. It has no listener and no model loop.
Dependencies are isolated in its private runtime directory. An audit guard denies
subprocess/network operations for this SQLite recipe, but this is **trusted local
code, not an OS sandbox**. It runs with the OS account's authority. Checksums
detect accidental source drift, not a hostile process with the same OS access.

Installation is staged under the private app data directory and activated only
after checksum/import checks. Interrupted downloads remain visible and can be
retried. No repository hook or unpinned dependency installation runs at tool time.
If an activated runtime has been modified, setup refuses to overwrite it. Stop
SLIM and move that exact runtime directory aside before reinstalling; preserve
`plugin-bindings` and its receipts. This preview has no automatic tamper repair.
Different reviewed runtime revisions use separate directories; previous data and
receipts are retained. General plugin updates, migrations, rollback and runtime
garbage collection are future lifecycle work, not implied by this preview.

## Recovery

Each call carries SLIM's persisted operation ID and expected fingerprint. The
worker uses a durable SQLite journal and process lock. Repeated completed IDs
reuse receipts, changed arguments are refused, and interrupted dispatch becomes
unknown. Holds survive reconnects and aliases sharing the installation/project
identity. Configuration changes are blocked while an affected operation is
running or unknown.

The Hub shows unresolved operations. After inspecting the database outcome,
record the resolution there; this closes the worker and SLIM holds without
replaying the operation. Disabled bindings retain inspection/recovery access.
Keep the `plugin-bindings/receipts` directory and installation identity. Removing
them would discard recovery evidence. Disabling does not prove an interrupted
external effect was cancelled.

## Verification

`tests/helpers/native-plugin-live-check.ts --download` is an opt-in real-source
test. It downloads the independent runtime, executes real DB Hub tools from a
native SLIM chat using a synthetic model, verifies schema/status, restart receipt
reuse and unchanged database bytes. It asserts that Agent Zero's `agent` module
is absent. No provider account or existing database is used.

Use `--keep` to retain its disposable runtime, then run
`python3 tests/helpers/native-plugin-worker-tests.py <runtime-directory>` for
offline real-plugin recovery, tamper, scope, disable and symlink cases. Default
CI performs Node route/installer/permission regressions without these downloads.
After building, `npm run test:package -- --plugins` installs the npm tarball in
a temporary directory and repeats the real-plugin proof using its compiled app
and bundled worker. The flag explicitly opts into the public Python/plugin
downloads; ordinary package checks only validate that those files are included.
See [acceptance evidence](verification/NATIVE-PLUGINS.md) for tested platforms and
the distinction between original plugin execution and synthetic model output.
