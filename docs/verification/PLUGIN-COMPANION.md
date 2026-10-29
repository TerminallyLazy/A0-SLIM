# Plugin companion acceptance

Verified on 2026-10-29 UTC (28 October in the owner's time zone).

## Scope and stack

| Component | Exact tested version |
| --- | --- |
| Agent Zero | 2.14, `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a` |
| DB Hub | 1.0.0, `9f3b9926cdd815034b0f9f635c60909107d1f2da` |
| Companion | 0.1.0, source-only ZIP, SHA-256 `ae27f2a4a0c63c1001242b705c918837d0e3be0308d109ab8bc61f7d587896e1` |
| Framework environment | Linux arm64, Python 3.12.4, MCP Python SDK 1.27.0, FastMCP 3.2.4, SQLAlchemy 2.0.52, LiteLLM 1.88.1 |
| Dependency image | `e5da090cb2a0f8c7bd5d909bd39e4539f1b86c8cf67f266cc57853ad62304768`; pinned framework sources copied into a clean `/slim-a0` root |
| SLIM test host | macOS arm64, Node 24.22.1, MCP JS SDK 1.32.2, libfx 0.0.14 with the existing cancellation patch |

The disposable container used `--network none`, no published ports, no host data
mounts and no provider credentials. It executed the exact packaged companion,
actual Agent Zero source and actual DB Hub tools. The SQLite database and its
`synthetic_inventory` table were generated for the test. No existing Agent Zero
container was changed. The Agent Zero reference checkout stayed read-only.

## Passed evidence

- **Native chat to actual plugin:** `tests/helpers/companion-live-check.ts` used
  the native libfx runtime with a synthetic model to stage `mcp_call`. Before
  approval the receipt was pending. Exact approval invoked the companion over
  stdio, dispatched DB Hub's Python `db_schema`, and returned
  `synthetic_inventory`. `db_status` then returned `ok: true`, driver
  `sqlalchemy`, dialect `sqlite`. No second agent or external model was used.
  Reapproving the completed SLIM call reused its receipt.
- **Actual plugin with failure fixtures:** 11 framework tests in
  `tests/helpers/companion-host-tests.py` passed. These cover remote receipt
  reuse across new Host instances, changed-argument rejection, unauthorized
  connections/operations, revision mismatch, profile policy and configuration
  changes, project/profile isolation, disable with inspection retained,
  unreviewed Python overrides, hook-mutated argument rejection, and synthetic
  secret masking in the result and durable receipt.
- **Crash boundary:** a child process executed the real schema tool and exited
  with code 77 immediately before storing completion. Reopening preserved an
  unknown operation and blocked a new call. Explicit reconciliation closed the
  hold without replay. The fixture deliberately injected the process exit; it
  is not a claim about exactly-once writes or provider-side effects.
- **Cross-process exclusion:** a second process could not acquire the active
  journal lock or mark the live operation abandoned. Recovery changed a
  `running` record to `unknown` only after the writer lock was available.
- **Native transport regressions:** a synthetic HTTP MCP fixture verified that
  the client supplies its own operation UUID and expected fingerprint, and that
  unresolved companion effects block a second URL alias sharing the discovered
  host scope. Existing generic MCP and Agent Zero token-custody tests still pass.
- **Repository checks:** Node 24 `npm run check` passed 147 tests, TypeScript and
  the production build. Subsequent Hub evidence-label changes passed the focused
  compatibility/extension tests and a fresh build. `npm audit --audit-level=high`
  reported zero vulnerabilities. `npm run test:package` passed packed CLI startup,
  native libfx, cancellation, SQLite, UI asset and optional-runtime checks.
- **Packaging:** the deterministic companion ZIP contains eight explicitly
  listed source/manifest/license files. ZIP integrity and exact contents passed;
  the archive was extracted into the disposable host before acceptance. Its
  1,283 source hashes are reproducible from immutable Git objects with
  `scripts/pin-plugin-companion.py`. It includes no runtime dependencies,
  configuration, databases, credentials or user data.

Native MCP operation receipts from the final packaged proof:
`7636707e-2325-4d67-87ef-e1bbc97ba89a` (schema) and
`286499db-7500-42d7-97df-fe599d770640` (status). These identify disposable test
operations, not production-account actions.

The completed synthetic host receipts and tested ZIP were retained locally before
removing the exact disposable container `a0-slim-plugin-proof-20261028`
(`f6aa29d59492`). Readback confirmed that container was absent; no existing
Agent Zero host was removed. The public [native proof](plugin-companion-native.json)
records the approved operation IDs and bounded results.

## Reproducing the proof

1. Prepare a disposable host from a compatible framework dependency image, with
   networking disabled and no host data mounts. Copy the exact pinned Agent Zero
   source into `/slim-a0` and DB Hub into `/slim-a0/usr/plugins/db_hub`.
2. Build `python3 scripts/package-plugin-companion.py --output /tmp/slim-tools-bridge.zip`
   and extract it into `/slim-a0/usr/plugins/slim_tools_bridge`.
3. Run `tests/helpers/companion-host-fixture.py` in `/slim-a0` using the framework
   Python. It refuses a non-fixture location or an already-configured fixture.
4. Run `tests/helpers/companion-host-tests.py` there. Then run, from SLIM on Node 24,
   `node --import tsx tests/helpers/companion-live-check.ts a0-slim-plugin-proof-NAME`.
   The helper accepts only explicitly named disposable proof containers. Its
   Docker executable path is the tested macOS path; adjust it for another host.
5. Retain the synthetic receipts before removing the exact disposable container.
   Do not run fixture setup against an existing user instance.

The installed system npm 12.2.1 no longer read this repository's npm-shrinkwrap
for `ci`; the immutable dependency installation, audit and package smoke used npm
11.6.2 under Node 24. No lockfile or dependency version was changed to work around
that tooling difference.

## Remaining acceptance gates

- **Owner host and real model:** no owner Agent Zero configuration, database,
  provider account or model task was used. The synthetic model proves native
  dispatch, not autonomous task quality. Built-in Agent Zero MCP chat delegation
  and a real ACP plugin task retain their separate owner-instance acceptance gate.
- **Browser readback:** local browser automation was disabled in Work settings.
  The UI build passed; visual/interactive review of the new Hub actions has not
  been claimed. The plan canvas approval was received through its CLI.
- **Compatibility breadth:** only two operations and the SQLite/SQLAlchemy path
  are executable through this preview. Other DB Hub drivers, queries/writes,
  memory replacement, other plugins, dynamic skills resources and full plugin UI
  are not verified by this result.
- **Lifecycle and distribution:** no managed host installer/updater, remote HTTP
  companion, public companion release, npm release, production deployment or
  per-plugin sandbox is delivered. Keep installation identity and receipts during
  manual updates. Host trust and package-specific dependency validation remain
  necessary.

The approved plan's local prototype and recovery proof are delivered. The real
ACP/owner-host and browser portions of phase 3 remain open as listed above.
