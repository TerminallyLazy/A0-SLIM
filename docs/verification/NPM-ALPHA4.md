# npm alpha.4 release

Published October 29, 2026 as public `a0-slim@0.1.0-alpha.4` with npm tag `latest`. PR #2 merged at `3cb358bb5aa4557161cfd65f3d8d7820371c1d7f`. Application source: `1bbccf704d4c06b74b3a35c952b7a98303137dca`, built with Node 24.22.1/npm 11.19.1 from a clean Git archive. The exact tested tarball was published without rebuilding it.

This release adds the owner-supplied slashed-zero wordmark, Appearance banners and New Chat polish, plus the compact Memory inspector layout fix already merged into main. New Chat no longer contains the tilted logo tile; its heading and task starters align with the composer, and selecting a starter focuses its draft without sending it. See [branding verification](BRANDING.md).

| Artifact | Value |
| --- | --- |
| Tarball bytes | 574,404 |
| Unpacked application bytes | 2,263,617 |
| Files | 195 |
| SHA-256 | `f5d99b13968b1471ea43abf5cc628933906a1d766fa43a973e65c0ed0e1b7ee7` |
| npm integrity | `sha512-5t9HWf304MWh0FzEnxulnpne1oyauIbGNOxC+9hdzj3Wo7GcjV7r1wg+90n72mHWTWJk03xaG7rAs4kbL3Spow==` |

The ordinary [public npm tarball](https://registry.npmjs.org/a0-slim/-/a0-slim-0.1.0-alpha.4.tgz) returned HTTP 200 at 2026-10-29 07:40:33 UTC and matched the tested SHA-256 and SHA-512 exactly. Registry metadata reported alpha.4 as latest with matching integrity. npm first accepted the publication for processing, then its CDN retained a cached 404 for five minutes. The installer pin changed only after ordinary public retrieval succeeded.

## Verification

- `npm run check` passed all 196 tests, TypeScript, installer synchronization and the production build from the clean release source. The release check caught and corrected the separate runtime version constant before publication.
- [Linux/macOS release-source CI](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40835591649) and [CodeQL](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40835591736) passed. Root, local-embedding and Microsandbox high-severity audits found zero vulnerabilities.
- Both branding WebP files and their provenance manifest are present in the tarball. The obsolete horizontal SVG banner is absent. Original supplied PNG hashes remain unchanged.
- The exact local artifact and the public `a0-slim@0.1.0-alpha.4` registry package each passed isolated global installation, two CLI startups, bundled UI serving, SQLite/native libfx loading, early cancellation, optional embedding CPU probing and removal. Private data, credentials, build dependencies and model weights were excluded.
- The updated installer downloaded alpha.4 from the public registry and passed both existing-Node and private-Node paths: bare command registration, startup, pairing, UI serving, existing-service reuse and clean stop. Repeated installation with downloads disabled passed for both paths. All 23 focused installer/update regressions passed.
- Automatic-update acceptance used the alpha.4 artifact with synthetic registry metadata and real dependency installation. One launch upgraded and started the app, preserving prior-release and saved-data sentinels. This fixture check is separate from the public-registry installation evidence.

Managed installations discover alpha.4 through the existing daily startup check, or immediately with `a0-slim update`. Running services are not interrupted; an installed update becomes active on the next service start. npm installations keep their existing update command. No live model allowance or cloud sandbox was used for these release checks; existing provider/account and plugin-scope limits remain in the feature verification records.
