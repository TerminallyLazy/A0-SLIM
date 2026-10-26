# Third-party notices

## Agent Zero

Reference repository: https://github.com/agent0ai/agent-zero

Reference checkout revision: `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`.

The two SVG symbols in `docs/review/assets/` and `ui/public/` were copied unchanged from `docs/res/a0-vector-graphics/darkSymbol.svg` and `lightSymbol.svg`. Their SHA-256 hashes are recorded in the source audit. The upstream MIT license and copyright notice are retained in [docs/licenses/Agent-Zero-MIT.txt](docs/licenses/Agent-Zero-MIT.txt). The preserved preliminary spec contains user-supplied Agent Zero source excerpts.

Brand names and logos identify their respective projects. This project does not claim upstream endorsement. Confirm any separate brand-use requirements before a public product launch.

Additional owner-supplied square, horizontal and centered logo artwork and the Illustrator master are preserved unchanged in `docs/brand/agent-zero/`, with source paths and hashes in its `sources.json`. The horizontal banner is also copied unchanged to `ui/public/a0-horizontal-banner.svg` and used in the Appearance attribution area.

## libfx

Pinned runtime dependency: `libfx@0.0.14`, from https://github.com/vercel-labs/fx, Apache-2.0. The npm package supplies its native binaries, WASM and source; these are not checked into this repository. `scripts/patch-libfx.cjs` applies a narrow stream-cancellation fix to the pinned package during installation. Its source hashes and rationale are documented in `docs/verification/P0.md`. Preserve applicable dependency notices when distributing the application.

Other dependency versions and resolved integrity values are pinned in `package-lock.json`; their licenses remain in the installed packages.

## Modal

The optional cloud check uses `modal@0.11.1`, Apache-2.0, from https://github.com/modal-labs/modal-client. The SDK is installed through npm and is not vendored. Preserve its applicable notices in any distributed application.


## E2B and Daytona

The synthetic check adapters use `e2b@2.59.0` (Apache-2.0, https://github.com/e2b-dev/E2B) and `@daytonaio/sdk@0.226.1` (Apache-2.0, https://github.com/daytonaio/daytona). These dependencies are installed through npm, not vendored. Retain their applicable notices when distributing the app.

## Sandbox provider artwork

Unchanged official SVG artwork is retained in `ui/public/providers/`. Exact source URLs, retrieval date and SHA-256 hashes are in `sources.json` beside the assets. Docker’s ocean-blue symbol comes from its [official logo kit](https://www.docker.com/company/newsroom/media-resources/); Vercel’s black symbol from [Geist brand assets](https://vercel.com/geist/brands); Modal’s green symbol from the download link on [its official homepage](https://modal.com/); E2B’s medium black symbol from [its brand library](https://changelog.e2b.dev/brand); Daytona’s wordmark from the navigation SVG in [its official documentation](https://www.daytona.io/docs/en/). Artwork proportions and colors are preserved on a light background. The marks identify optional integrations; their owners retain trademark rights, and no endorsement is implied.
