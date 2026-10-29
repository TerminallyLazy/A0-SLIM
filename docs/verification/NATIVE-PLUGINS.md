# Independent plugin worker acceptance

2026-10-29 · macOS arm64 · Node 24.22.1

The native SLIM path executes original DB Hub code without an Agent Zero
installation, source checkout on the import path, Docker, system Python or a
second agent/model loop. This is a bounded DB Hub preview, not compatibility with
every entry in the Hub.

## Exact capability

| Component | Verified revision |
| --- | --- |
| DB Hub | 1.0.0, `9f3b9926cdd815034b0f9f635c60909107d1f2da` |
| Worker / compatibility API | 0.1.0 |
| Worker bundle fingerprint | `06b5766ab6f94127092515acecdd0e4faa12ac017ddda5abe748a3c79fd578ac` |
| Python | standalone 3.12.16, release 20261026, macOS arm64 |
| SQLAlchemy | 2.0.52 |
| Operations | original `db_status`, `db_schema`; MCP `db_hub_status`, `db_hub_schema` |
| Data | disposable SQLite table `synthetic_inventory(id, label)` |
| Model | synthetic local model transport driving the native libfx runtime |

The source recipe, runtime archives and wheel hashes are included in
`addons/plugin-worker`. Eleven original plugin/license files are downloaded
unchanged. The worker asserts that Agent Zero's `agent` module is absent.

## Evidence

- `npm run check`: 199 tests, TypeScript and production build passed. The
  native-runtime, cancellation, per-turn capability and MCP recovery regressions
  remain included. Native-plugin tests cover download opt-in, concurrent install
  requests, failed/interrupted setup, checksum/size rejection, fixed download
  destinations, origin/pairing and
  project authority.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `npm run test:package -- --plugins`: passed against an installed local npm
  tarball on the alpha.4 baseline. It loaded the compiled app and worker from the
  installed package, downloaded the independent runtime, and executed original
  DB Hub tools. Both legacy staged calls and the current inline approval path
  passed; inline approval returned the result to the same native model turn.
  The normal packaged CLI, SQLite, cancellation and optional add-on probes also
  passed. This was a local candidate artifact, not a newly published npm release.
- `tests/helpers/native-plugin-live-check.ts --download --keep`: actual pinned
  Python tools ran from a native SLIM chat. The call was staged and approved,
  returned the known schema, and reused its completed receipt after restart.
  A subsequent column query and status call passed. Database bytes were unchanged.
  An unknown call through a second connection to the same scope blocked setup;
  explicit reconciliation released the hold without dispatch. Disable blocked
  further calls.
- `tests/helpers/native-plugin-worker-tests.py`: seven real-worker cases passed.
  Coverage includes duplicate receipt reuse, changed arguments, missing operation
  metadata, binding/source drift, unexpected files, database symlinks, disabled
  inspection and a forced process exit after tool execution but before receipt
  completion. The crash remained unknown and blocked later dispatch until
  reconciliation; it was not replayed.
- Browser: in an isolated synthetic workspace, Plugin Hub → Database Hub →
  **Use DB Hub in SLIM** accepted `fixture.sqlite`, required local process consent,
  and reported **DB Hub enabled for this project**. This used the real installed
  runtime and public catalog, not a mocked setup response.

The machine-readable synthetic operation receipt is
[native-plugin-proof.json](native-plugin-proof.json). Screenshots and temporary
runtime directories remain outside the public repository.

The packed candidate SHA-512 integrity was
`sha512-7VBiZG6drFVaQt2Gbd01L/P1RWFSM8Kfdj3TU+k/DUHaykDmzpiQUOllROLYFjwNjkU9LkOvN9cMLUhHRmPm8w==`.
Its four synthetic operation IDs are retained in the receipt's `packedCandidate`
section. No public-release or real-provider acceptance is implied by this check.

## Limits

Only macOS arm64 has real-runtime acceptance in this receipt. Runtime recipes
exist for macOS x64 and glibc Linux arm64/x64; those platforms still need their
own actual-plugin proof. Musl Linux and Windows are unsupported.

This proves execution of the original plugin tools, with a synthetic model and
synthetic database. It does not prove provider-account behavior, performance on
production databases, writes, other database drivers, memory replacement,
scheduler hooks, original plugin screens or arbitrary Hub packages. No model
account, private database or existing Agent Zero state was used.

The worker is trusted local process execution, not an OS sandbox. Hashes and
import isolation do not protect against a hostile process with the same OS
authority. Interrupted dispatch remains uncertain; disabling is not proof of
cancelled effects. General plugin upgrades, data migration, rollback, automatic
tamper repair and runtime garbage collection remain future work.

The separate Memory sidebar fix is `21a8aba`: description and permissions stack
at inspector width, with browser readback confirming no horizontal overflow.
The full-page Memory layout retains its desktop arrangement.
