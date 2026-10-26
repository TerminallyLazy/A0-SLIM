# A0 SLIM

A local-first agent workspace inspired by Agent Zero, built around the libfx agent engine. Choose your models, keep your workspace and memory locally, and connect the execution environments and extensions you need.

**Status: research and design review. The application is not implemented yet.**

- [Revised build specification](A0-SLIM-SPEC.md)
- [Interactive design and plan review](docs/review/index.html) — open locally or through ECC Plan Canvas
- [Research and source audit](docs/research/SOURCE-AUDIT.md)
- [Untouched preliminary specification](docs/original/A0-SLIM-SPEC.md)
- [Decisions and delivery stages](docs/DECISIONS.md)

The intended product runs a local Node service and a browser UI. Local Docker is optional. Model access, embeddings, sandbox services, and extensions are independently configurable. ChatGPT subscription access is included in the design, with an explicit compatibility validation before release.

A0 SLIM is an independent project; it is not a drop-in replacement for Agent Zero. Original Agent Zero brand assets are used with source attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This repository currently contains planning documents and a visual prototype. It does not provide an installable agent, working provider connections, or a production sandbox.
