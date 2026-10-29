# Updates

For a curl installation, run `a0-slim` normally. Automatic updates are on by default. Before starting the local service, the launcher checks npm's `latest` release at most once every 24 hours and installs a newer compatible version. It prints progress when there is an update. A failed or offline check leaves the working installation available and starts it normally. Reopening an already-running default instance does not check, install or restart anything.

| Command | Action |
| --- | --- |
| `a0-slim update` | Check now and install a newer release, even if today's automatic check already ran. |
| `a0-slim update --check` | Check now without installing. |
| `a0-slim update --auto=off` | Disable automatic updates for this installation. |
| `a0-slim update --auto=on` | Enable them again. |
| `a0-slim --version` | Print the installed version without starting a service. |
| `A0_SLIM_NO_UPDATE=1 a0-slim` | Skip the automatic check for this launch. |

Existing curl installations need to run the installer once to get the managed updater:

```sh
curl -fsSL https://raw.githubusercontent.com/TerminallyLazy/A0-SLIM/main/install.sh | sh
```

The new bootstrap installs the updater beside the private launcher, so the first upgrade does not depend on an old npm package already having update support. Re-running the installer preserves a verified newer release instead of downgrading it to the bootstrap version. Future packages can supply their own updater implementation. The generated installer copies are checked against the owned modules by `npm run check`; maintainers regenerate them with `npm run sync:installer`.

An update installed during a running session becomes active on the next service start. The launcher can reopen the current service and explains when a newer version is installed. Stop the service with Ctrl+C in its original terminal when ready, then run `a0-slim` again. No update kills a running chat or restarts its sandbox. Normal restart pairing still applies.

## Verification and recovery

Release metadata comes from the fixed HTTPS npm registry URL. The package name, version, exact tarball URL and SHA-512 integrity are checked. Redirected downloads and oversized responses are rejected. Metadata requests have a five-second deadline; the full update has a ten-minute deadline. Only a newer version is installed; the alpha `latest` tag remains an alpha release channel.

Installation uses the managed Node/npm runtime, empty npm configuration and an environment without inherited npm credentials. npm lifecycle scripts are disabled, the published shrinkwrap controls dependencies, and incompatible engine requirements fail before activation. The staged package must pass its exact libfx patch, SQLite/CBOR/native-agent probes and CLI help check. This follows [npm's documented `ignore-scripts` behavior](https://docs.npmjs.com/cli/v11/commands/npm-install/).

Only then does an atomic symlink replacement make the release active. The previous release remains under `releases/`; user data, credentials, workspaces, models and add-ons are outside the update. Automatic checks do not download model weights or optional runtimes. A pre-activation failure or cancellation removes staging and leaves the previous active release unchanged. There is no automatic downgrade after opening a newer database schema.

The installer and updater share a lock. A normal cancellation waits for child processes to stop and removes it. After a hard kill, inspect the installer/updater processes before removing the empty `.install-lock` directory and retrying. Old releases are retained; automatic cleanup is not included. Node runtime major upgrades still require a compatible installer.

npm and source installations keep their existing manager. For npm on the supported platforms, use `npm install -g a0-slim@latest --ignore-scripts`; the CLI's `update` command explains this instead of modifying an unmanaged package or repository. Use the curl installer for automatic managed updates. No app data is migrated between installation methods.

## Acceptance

Regression tests cover version ordering, metadata and checksum rejection, download bounds, offline startup, failed installation/probing, cancellation, lock ownership, daily backoff, opt-out, explicit retries, no downgrades and preservation of user data. The real update smoke packs this checkout, provides synthetic registry metadata for that exact artifact, performs an actual npm dependency installation, and launches the managed command. That single launch upgrades the fixture installation, starts the updated app, pairs its API, serves the UI and shuts down cleanly. CI runs it on macOS and Linux. This is a local-artifact acceptance test, not publication of a new npm release.

The local macOS receipt records Node 24.22.1, 190 passing repository tests, typecheck/build/package checks, both installer runtime paths and zero audit vulnerabilities. See [update-acceptance.json](verification/update-acceptance.json).
