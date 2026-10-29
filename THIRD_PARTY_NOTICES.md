# Third-party notices

## Agent Zero

Reference repository: https://github.com/agent0ai/agent-zero

Reference checkout revision: `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`.

The two SVG symbols in `docs/review/assets/` and `ui/public/` were copied unchanged from `docs/res/a0-vector-graphics/darkSymbol.svg` and `lightSymbol.svg`. Their SHA-256 hashes are recorded in the source audit. The upstream MIT license and copyright notice are retained in [docs/licenses/Agent-Zero-MIT.txt](docs/licenses/Agent-Zero-MIT.txt). The preserved preliminary spec contains user-supplied Agent Zero source excerpts.

Brand names and logos identify their respective projects. This project does not claim upstream endorsement. Confirm any separate brand-use requirements before a public product launch.

Additional owner-supplied square, horizontal and centered logo artwork and the Illustrator master are preserved unchanged in `docs/brand/agent-zero/`, with source paths and hashes in its `sources.json`. These source files remain preserved for provenance. The current app uses the owner-supplied A0 SLIM wordmark and banners in `ui/public/brand/`; its manifest records original filenames, SHA-256 hashes, dimensions and WebP optimization. CSS frames the horizontal artwork and adapts its monochrome presentation to the selected theme. The Appearance area retains the Agent Zero attribution and link.

## libfx

Pinned runtime dependency: `libfx@0.0.14`, from https://github.com/vercel-labs/fx, Apache-2.0. The npm package supplies its native binaries, WASM and source; these are not checked into this repository. `scripts/patch-libfx.cjs` applies a narrow stream-cancellation fix to the pinned package during installation. Its source hashes and rationale are documented in `docs/verification/P0.md`. Preserve applicable dependency notices when distributing the application.

Other dependency versions and resolved integrity values are pinned in `npm-shrinkwrap.json`; their licenses remain in the installed packages. The optional local inference graph has a separate `addons/local-embeddings/npm-shrinkwrap.json`.

## Modal

The optional cloud check uses `modal@0.11.1`, Apache-2.0, from https://github.com/modal-labs/modal-client. The SDK is installed through npm and is not vendored. Preserve its applicable notices in any distributed application.


## E2B and Daytona

The synthetic check adapters use `e2b@2.59.0` (Apache-2.0, https://github.com/e2b-dev/E2B) and `@daytonaio/sdk@0.226.1` (Apache-2.0, https://github.com/daytonaio/daytona). These dependencies are installed through npm, not vendored. Retain their applicable notices when distributing the app.

## Sandbox provider artwork

Unchanged official SVG artwork is retained in `ui/public/providers/`. Exact source URLs, retrieval date and SHA-256 hashes are in `sources.json` beside the assets. Docker’s ocean-blue symbol comes from its [official logo kit](https://www.docker.com/company/newsroom/media-resources/); Vercel’s black symbol from [Geist brand assets](https://vercel.com/geist/brands); Modal’s green symbol from the download link on [its official homepage](https://modal.com/); E2B’s medium black symbol from [its brand library](https://changelog.e2b.dev/brand); Daytona’s wordmark from the navigation SVG in [its official documentation](https://www.daytona.io/docs/en/). Artwork proportions and colors are preserved on a light background. The marks identify optional integrations; their owners retain trademark rights, and no endorsement is implied.

## P2 libraries and optional model

- `@modelcontextprotocol/sdk` 1.32.2 — MIT, https://github.com/modelcontextprotocol/typescript-sdk.
- `@huggingface/transformers` 4.3.1 — Apache-2.0, https://github.com/huggingface/transformers.js. Transitive ONNX Runtime code retains its upstream licenses in the installed packages.
- `yaml` 2.9.1 — ISC, https://github.com/eemeli/yaml.
- Optional `Xenova/all-MiniLM-L6-v2`, revision `751bff37182d3f1213fa05d7196b954e230abad9` — Apache-2.0 model card. Weights are not bundled; the user starts a download into local app storage. `src/memory/local-model.json` records the exact files, sizes, and SHA-256 checksums.
- Plugin Hub descriptions and user-requested portable skills remain attributed to their source repository and exact revision. Discovery does not imply endorsement or permission to redistribute a full plugin. No third-party skill body is bundled by this change.


## Markdown rendering

`react-markdown` 10.1.0 and `remark-gfm` 4.0.1 are MIT-licensed packages from https://github.com/remarkjs/react-markdown and https://github.com/remarkjs/remark-gfm. They, React, Lucide icons and their dependency graph are bundled into the built UI. The build emits their full installed license/notice texts to `dist/ui/THIRD_PARTY_LICENSES.txt`, included in the npm tarball; standalone UI build packages are not runtime dependencies.

## Agent Client Protocol SDK

Pinned dependency: `@agentclientprotocol/sdk@2.0.2`, Apache-2.0, Zed Industries. Source: https://github.com/agentclientprotocol/typescript-sdk. Uses the stable ACP v1 interface. Preserve its packaged LICENSE and applicable notices when distributing. Agent executables are separately installed and licensed; none are bundled by SLIM.

Microsandbox is an optional user-installed runtime, pinned to version 0.7.11 (Apache-2.0). Its SDK and native binaries are downloaded separately from npm and are not bundled with the core package. The official documentation icon is used to identify the integration; provenance is recorded in `ui/public/providers/sources.json`.

## NVIDIA OpenShell

The optional, user-installed `@nvidia/openshell-sdk@0.1.6` is Apache-2.0, copyright NVIDIA CORPORATION & AFFILIATES. Source: https://github.com/NVIDIA/OpenShell/tree/v0.1.6/sdk/typescript. SDK code and its dependencies are not vendored or bundled into core. Retain its applicable license notices in the separate installation. The official OpenShell favicon is copied unchanged from the pinned source to identify the integration; provenance and hash are in `ui/public/providers/sources.json`. NVIDIA retains its trademark rights; no endorsement is implied. The upstream Apache-2.0 license is retained in `docs/licenses/OpenShell-Apache-2.0.txt` for the artwork.
