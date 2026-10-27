# First-run setup

Install SLIM, pair the browser, and connect a model. The npm package includes the native agent, project tools, skills, MCP, memory and reviewed file proposals. Agent Zero itself is an optional external ACP agent, not a prerequisite.

1. Run the one-command installer in the README, or install `a0-slim` with Node 24/npm 11.19+ and launch `a0-slim`.
2. The local browser page opens. Enter the one-time pairing code printed in that terminal. `--no-open` or `A0_SLIM_NO_BROWSER=1` suppresses browser opening.
3. Choose **Sign in with ChatGPT**, complete the account sign-in, and choose a model returned by that account. Alternatively, choose **Use an API key or local model** for a compatible API, Ollama, LM Studio or Vercel AI Gateway. ChatGPT support is experimental; availability and allowance belong to the account. Authentication/model discovery is not proof of inference.
4. Choose **Create my workspace** to create `~/SLIM Workspace`, or explicitly select an existing folder. The default folder is created only on this action. An existing unrelated directory is never adopted automatically.
5. Choose **Start working**, then send a task. No external Agent Zero installation, Docker, cloud sandbox or embedding runtime is required for chat and project tools. Setup does not send project contents or invoke a model.

## Optional Bash

On supported Apple Silicon macOS or Linux/KVM systems, expand **Add local Bash**. Explicitly acknowledge the runtime/image download and one synthetic local sandbox check, then choose **Install, check and start**. Activation requires a passing check and verified deletion. No cloud account or model allowance is used. The runtime and image stay outside the core npm installation. Sandbox files are disposable per call.

You can start without code execution and use Environments later. Docker and Vercel have their own setup and checks. Host Bash has OS-account access and always requires a separate per-project permission; first-run setup never grants it.

## Resume and recover

Account and folder choices persist across reloads and service restarts. Failed sign-in stays on setup with a retry message. If model discovery fails, retry it or connect another model. Incomplete or changed workspace ownership requires explicit folder selection; it is never repaired by silently granting access.

Downloads continue in the local service if the browser closes. Reopening setup shows the saved choices; downloading, checking and enabling execution require an action. A failed/unknown sandbox receipt stays available in Environments with the existing recovery safeguards. Start without execution to review it there.

Existing configured installations keep their projects, permissions and chat identities. The setup guide does not reset them. Full Agent Zero Python plugins still run on an external Agent Zero instance; native SLIM extensions keep their existing compatibility boundaries.
