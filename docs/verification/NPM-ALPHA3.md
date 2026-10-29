# npm alpha.3 release

Published October 29, 2026 as public `a0-slim@0.1.0-alpha.3` with npm tag `latest`. MIT license. Application source: `e913abda84e2f08d06e41bea1ff839b4ce47c989`, built with `npm ci` and a production build from a clean Git archive. The tested tarball was published directly, without rebuilding it during publication.

This release adds the bounded Plugin Hub/DB Hub companion route, three access modes (Approve for me by default), automatic MCP tool discovery/enablement, 15-minute sandbox lifetimes and entry-plan sizing choices, command/PATH registration, managed startup updates, composer cleanup, and twelve customizable themes with dark/light previews and Save/Reset.

| Artifact | Value |
| --- | --- |
| Tarball bytes | 526,540 |
| Unpacked application bytes | 2,217,332 |
| Files | 193 |
| SHA-256 | `10da07d7c4b18acf5eacfc4fa1fb18ff31eb59e52b434a51d990905850632959` |
| npm integrity | `sha512-1JCFHIEBGqbb5JN7lbqiXN44jTa3EenSgcurFHT9lHFBPtFNNiK7wNcKAidDukCeJLOiE6z/bvbusuLQJ0NxtA==` |

The normal [public npm tarball](https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.3.tgz) returned HTTP 200 at 2026-10-29 06:38:40 UTC and matched the tested artifact byte-for-byte. Registry metadata reported alpha.3 as latest with matching SHA-512 integrity. npm initially accepted the publication for processing, then exposed metadata before its CDN stopped returning a cached 404. The installer pin was updated only after ordinary public retrieval succeeded.

## Verification

- Node 24.22.1: 196 tests, TypeScript and production build passed, including the installer synchronization check. Root, local-embedding and Microsandbox audits found zero vulnerabilities.
- [Linux/macOS application-source CI](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40829301283), [CodeQL](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40829301274), and [ECC security evidence](https://github.com/TerminallyLazy/A0-SLIM/pull/1#issuecomment-6489633543) passed at the application source commit. ECC reports through comments because its Checks write permission is unavailable; neutral recommendations are not security failures.
- The exact clean tarball passed isolated global installation, two CLI startups, UI serving, SQLite/libfx loading, early cancellation, optional embedding CPU probe and removal. No private data, credentials, build dependencies or model weights were packaged.
- The same checks passed using `--package a0-slim@0.1.0-alpha.3 --global-install` from the public registry.
- The updated installer downloaded the public release and passed existing-Node and private-Node paths: command registration, startup, pairing, UI serving, existing-service reuse and clean stop. Repeated installation with downloads disabled passed in both paths.
- Automatic-update acceptance installed the alpha.3 artifact using fixture registry metadata and real dependencies, started the updated app in one launch, and preserved old-release and saved-data sentinels. This synthetic registry check is separate from the public installation evidence above.
- [Theme acceptance](THEMES.md) covers preview isolation, Save/Reset, custom gradients, light/dark persistence, contrast checks, migration and mobile layouts.

The curl installer change is on PR #1 until it merges; the main-branch curl command receives that change when the PR merges. The public npm package is already available independently. No live model allowance or cloud sandbox was used for these release checks. Existing provider/account and plugin-scope limits remain documented in the feature verification records.
