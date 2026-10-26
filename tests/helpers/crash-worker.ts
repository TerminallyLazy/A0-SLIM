import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFxAgent } from 'libfx';
import { local } from 'libfx/durable-local';
const [dir, endpoint] = process.argv.slice(2) as [string, string];
const agent = createFxAgent({
  name: 'crash-proof',
  model: 'fixture',
  provider: {
    name: 'crashfixture',
    baseUrl: endpoint,
    models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
  },
  durability: local({ dir }),
  tools: [
    {
      name: 'side_effect',
      description: 'Synthetic non-idempotent effect.',
      inputSchema: { type: 'object', properties: {} },
      idempotent: false,
      writes: true,
      execute: async () => {
        appendFileSync(join(dir, 'effects.txt'), 'effect\n');
        process.send?.({ type: 'effect' });
        await new Promise(() => {});
        return 'never';
      },
    },
  ],
});
const sessionId = await agent.newSessionId();
writeFileSync(join(dir, 'session-id'), sessionId);
void agent.session(sessionId).prompt('Run the synthetic effect.', { messageId: 'crash-first' })
  .result;
