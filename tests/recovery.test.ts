import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFxAgent } from 'libfx';
import { local } from 'libfx/durable-local';
import { startModelFixture } from './helpers/model-server.js';

test(
  'crash recovery marks an ambiguous effect but does not prevent the model requesting another call',
  { timeout: 20_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-crash-'));
    const fixture = await startModelFixture({ tool: 'side_effect' });
    const child = fork(
      fileURLToPath(new URL('./helpers/crash-worker.ts', import.meta.url)),
      [dir, fixture.url],
      { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    let agent: ReturnType<typeof createFxAgent> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Worker exited before effect (${code}).`)));
      });
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      const sessionId = await readFile(join(dir, 'session-id'), 'utf8');
      let replayed = 0;
      agent = createFxAgent({
        name: 'crash-proof',
        model: 'fixture',
        provider: {
          name: 'crashfixture',
          baseUrl: fixture.url,
          models: {
            fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true },
          },
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
              replayed++;
              await appendFile(join(dir, 'effects.txt'), 'replayed\n');
              return 'effect';
            },
          },
        ],
      });
      const result = await agent.session(sessionId).resume().result;
      assert.equal(result.stopReason, 'end_turn');
      assert.ok(
        fixture.requests
          .at(-1)!
          .messages.some(
            (message) =>
              message.role === 'tool' && String(message.content).includes('may have partly run'),
          ),
      );
      // This is a documented engine limitation, not successful side-effect recovery.
      // A new model-issued call is allowed despite idempotent:false. Slim must gate
      // unknown effects before enabling writes or arbitrary code execution.
      assert.equal(replayed, 1);
      assert.equal(await readFile(join(dir, 'effects.txt'), 'utf8'), 'effect\nreplayed\n');
    } finally {
      child.kill('SIGKILL');
      await agent?.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'explicit cancellation terminates the current turn and allows a subsequent prompt',
  { timeout: 10_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-cancel-'));
    const fixture = await startModelFixture({ delayMs: 500 });
    const agent = createFxAgent({
      name: 'cancel-proof',
      model: 'fixture',
      provider: {
        name: 'cancelfixture',
        baseUrl: fixture.url,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      durability: local({ dir }),
    });
    try {
      const session = agent.session();
      const turn = session.prompt('Start slowly.');
      await turn.accepted;
      while (!fixture.requests.length) await new Promise((r) => setTimeout(r, 5));
      await session.cancel();
      const result = await turn.result;
      assert.equal(result.stopReason, 'cancelled');
      const next = await session.prompt('Continue after cancel.').result;
      assert.equal(next.stopReason, 'end_turn');
    } finally {
      await agent.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
