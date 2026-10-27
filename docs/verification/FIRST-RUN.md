# First-run and alpha.2 verification

Validated locally on Apple Silicon macOS, Node 24.22.1, npm 11.19.1, October 26, 2026.

- TypeScript, production build and 131 tests pass, including five first-run cases. Native first chat lists the synthetic workspace through the real libfx loop without Agent Zero or a sandbox. Setup makes no inference call.
- ChatGPT fixture covers registration/PKCE callback, account model discovery, rejection of an invented model, explicit selection and completion. No live ChatGPT allowance used for this release check.
- Pairing and Origin checks protect setup routes. Workspace creation is concurrent/idempotent and never automatically adopts unrelated, symlinked, private or ownership-changed directories. An interrupted directory without its marker requires explicit selection. Saved setup resumes; ready existing installations retain their preferences.
- Browser walkthrough covers pairing, local model setup, folder creation, completion, first native task and reload. Desktop 1280, intermediate 768 and mobile 390 layouts inspected; dark/light themes, heading focus, Bash disclosure and mobile overflow checked. No console errors. Reduced-motion CSS disables the completion stroke reveal and disclosure rotation transition.
- Impeccable mechanical scan found no issues. Removed unused eyebrow styles and uppercased navigation labels. No suppressions added. Existing semantic Markdown blockquote styling retained.
- Root, local-embedding and Microsandbox dependency audits report zero vulnerabilities. No runtime dependency was added. Package smoke validates CLI restart, bundled UI, SQLite/libfx, cancellation, optional embedding install/probe/removal and absence of ML/UI build dependencies in core.

Bash’s separate local Docker/Microsandbox and recovery evidence is in [BASH.md](BASH.md). This release does not add a new live Vercel/ChatGPT acceptance claim. npm publication, public installation and installer receipts are recorded in the GitHub release after the exact artifact is published.
