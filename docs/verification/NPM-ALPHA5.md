# npm alpha.5 release

Published October 29, 2026 as public `a0-slim@0.1.0-alpha.5` with npm tag `latest`.
[PR #3](https://github.com/TerminallyLazy/A0-SLIM/pull/3) merged at
`7a7fc06334264b7833f36de5ce98ad62890050ed`. Application source:
`dc61b801a9bac58f4826909cd5deedfdc694453f`, built with Node 24.22.1 from a clean
Git archive. The exact tested tarball was published without rebuilding it.

This release adds the optional independent Python plugin worker and **Use DB Hub
in SLIM** setup in the Plugin Hub. It runs the original DB Hub status and schema
tools against existing project SQLite files, read-only, without installing Agent
Zero. It includes the previously merged compact Memory inspector layout fix.
See [native plugin setup](../NATIVE-PLUGINS.md) and
[capability verification](NATIVE-PLUGINS.md) for exact revisions and limits.

| Artifact | Value |
| --- | --- |
| Tarball bytes | 600,157 |
| Unpacked application bytes | 2,346,551 |
| Files | 206 |
| SHA-256 | `a51d93860827ae6a582798633e91cca532b1cf4a28ca8de2d8bf81fbeb4dfe62` |
| npm integrity | `sha512-3/hu3SXDe/6RFoYzidOeLPP6SAyC96QP1QCKfONWSO+PLF9B6P3qIOjVJ8T2P0yUnSZzEci7jyUk2j3UCZsVSA==` |
| Installer SHA-256 | `1a0e734e3e0b09495ca341485406f1826f3a61e1d5bce997019b7ca7aa42721b` |

The ordinary [public npm tarball](https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.5.tgz)
returned HTTP 200 at `2026-10-29T08:29:56.382Z` and matched the tested SHA-256 and
SHA-512 exactly. Registry metadata reported alpha.5 as latest with matching
integrity. The installer pin changed only after ordinary public retrieval
succeeded. The [GitHub prerelease](https://github.com/TerminallyLazy/A0-SLIM/releases/tag/v0.1.0-alpha.5)
targets the application source commit and contains the same tarball, installer
and `SHA256SUMS`; public release metadata and asset digests were read back.

## Verification

- `npm run check` passed all 199 tests, TypeScript, installer synchronization and
  the production build. Root, local-embedding and Microsandbox high-severity
  audits found zero vulnerabilities.
- [Linux/macOS release-source CI](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40841106514)
  and [CodeQL](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40841106435)
  completed successfully for the application source commit above.
- The exact release tarball passed `test:package -- --package <tarball>
  --global-install --plugins`: global installation, two CLI startups, bundled UI,
  SQLite/native libfx, early cancellation, optional embedding CPU probe and
  removal. Original DB Hub code ran in the downloaded independent runtime with
  synthetic SQLite data and a synthetic model. Legacy staged approval and current
  inline approval with same-turn continuation passed, along with restart receipt
  reuse and the duplicate-connection unknown-effect hold.
- The public `a0-slim@0.1.0-alpha.5` registry package separately passed isolated
  global installation and the normal packaged runtime/add-on checks. Its bytes
  matched the locally tested plugin-enabled artifact.
- The alpha.5 installer passed both existing-Node and downloaded private-Node
  paths: command registration, startup, pairing, bundled UI, existing-service
  reuse and clean stop. Both paths passed repeat installation with downloads
  disabled. All 23 focused installer/update regressions passed.
- Automatic-update acceptance used the alpha.5 artifact with synthetic registry
  metadata and real dependency installation. One launch upgraded and started the
  app, preserving the previous release and saved-data sentinels. This fixture
  check is separate from the public-registry installation evidence.
- The owner's managed installation was upgraded from alpha.2 to alpha.5 through
  the verified installer. Saved database/WAL/SHM hashes were unchanged by the
  installer before app startup, and the previous release remained available.
  The installed CLI and running local service both reported alpha.5. Browser
  pairing succeeded; Plugin Hub → Database Hub → Assess compatibility displayed
  **Use DB Hub in SLIM**, the pinned source, and the explicit optional download
  with runtime **not-installed**. The app was left running on its local address.

## Acceptance limits

Actual original-plugin execution is verified on macOS arm64 only. Linux/macOS
general CI does not establish real Python plugin acceptance on other platforms.
DB Hub is pinned to `9f3b9926cdd815034b0f9f635c60909107d1f2da`, worker API 0.1.0,
Python 3.12.16 standalone release 20261026 and SQLAlchemy 2.0.52. The seven
real-worker regression cases and broader capability limits remain recorded in
[native plugin verification](NATIVE-PLUGINS.md).

The owner's optional plugin runtime was not downloaded or enabled during the
release update, and no private database or real model account was used for
release testing. This release does not establish arbitrary Hub plugin support,
database writes, other drivers, memory replacement, lifecycle hooks or original
Agent Zero screens. Runtime installation and project database access remain
explicit setup steps in the app.
