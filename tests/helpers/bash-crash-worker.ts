import { Store } from '../../src/storage/store.js';
import { Vault } from '../../src/providers/vault.js';
import { Bash } from '../../src/tools/bash.js';
import { DockerSandbox } from '../../src/execution/docker.js';
import { VercelExecution } from '../../src/execution/vercel-execution.js';
import { Microsandbox } from '../../src/execution/microsandbox.js';
const store = new Store(process.argv[2]!);
const chat = store.chats()[0]!;
const bash = new Bash(store, {
  docker: new DockerSandbox(store),
  vercel: new VercelExecution(store, new Vault(store, async () => Buffer.alloc(32, 1))),
  microsandbox: new Microsandbox(store),
});
await bash.run(
  { target: 'host', command: 'sleep 2; printf leaked > escaped.txt', timeout_ms: 5000 },
  {
    projectId: chat.projectId,
    sessionId: chat.sessionId!,
    messageId: 'crash-turn',
    callId: 'crash-call',
  },
);
store.close();
