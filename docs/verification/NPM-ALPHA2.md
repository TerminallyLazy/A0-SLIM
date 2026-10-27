# npm alpha.2 release

Published October 26, 2026 (America/Indiana/Indianapolis), as public `a0-slim@0.1.0-alpha.2` with npm tag `latest`. MIT license.

Application artifact source: `28276530cb75cac175de518c8a983523cd0c4aa0`. Built with `npm ci` and `npm pack` from a clean archive of that commit. Unrelated local branding edits were excluded. The release tag also includes the separately verified installer update and its regression test.

| Artifact measurement | Value |
| --- | --- |
| Tarball bytes | 463,508 |
| Unpacked application bytes | 1,965,153 |
| Files | 161 |
| SHA-256 | `c75f4df84092188fc17084c5f3c6a3a560c857d5020a74d46ec9645c23b98490` |
| npm integrity | `sha512-YMYQXztISNBfJnF/ArNPoOZpM6jR35uDUQ/6sy8Z0ocGhuqq/Tp+MKi6gVwTcLFDZ7v6xRsyEqrtkUNyKwU81g==` |

The public registry tarball matches the tested artifact byte-for-byte. The release includes that same tarball, `install.sh` and `SHA256SUMS`. Core plus production dependencies remains approximately 202 MB; Node and optional add-ons/images/weights are additional.

## Checks

- 131 application tests, TypeScript and production build passed; Linux and macOS [source CI passed](https://github.com/TerminallyLazy/A0-SLIM/actions/runs/40439701933).
- Root, local-embedding and Microsandbox audits reported zero vulnerabilities.
- The exact clean tarball passed isolated global install/start/restart, first-run state, UI serving, SQLite/libfx, cancellation and optional embedding install/probe/removal checks.
- The same checks passed with `--package a0-slim@0.1.0-alpha.2 --global-install`, using the public registry.
- The updated installer passed actual downloads with both an existing Node runtime and Node absent from PATH. It launched, paired, served the UI, reused the matching running service and stopped cleanly. Repeating installation with downloads disabled passed in both cases.
- Five offline installer regression tests passed, including refusal to silently reuse an older running version after upgrade.
- npm initially returned HTTP 202 for publication; a cached 404 delayed the ordinary tarball URL. The installer update was held until the normal public URL returned 200 and both public installation checks passed.

No live model allowance or cloud sandbox was used for these release checks. See [first-run/UI evidence](FIRST-RUN.md) and [Bash acceptance and limits](BASH.md).
