import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFxAgent, getBackendInfo, type FxStreamLine } from 'libfx';
import { local } from 'libfx/durable-local';
import { startModelFixture } from './helpers/model-server.js';

test(
  'native libfx completes a tool round trip, deduplicates a message, and reopens local history',
  { timeout: 30_000 },
  async () => {
    const fixture = await startModelFixture({ tool: 'read_note' });
    const dir = await mkdtemp(join(tmpdir(), 'a0-slim-runtime-'));
    let toolCalls = 0;
    const options = {
      name: 'p0-fixture',
      provider: {
        name: 'fixture',
        baseUrl: fixture.url,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      model: 'fixture',
      instructions: 'Use read_note, then answer.',
      tools: [
        {
          name: 'read_note',
          description: 'Read a synthetic note.',
          inputSchema: { type: 'object', properties: {} },
          idempotent: true,
          writes: false,
          execute: () => {
            toolCalls++;
            return 'A synthetic note.';
          },
        },
      ],
    };
    let agent = createFxAgent({ ...options, durability: local({ dir }) });
    try {
      assert.equal(
        (await getBackendInfo({ surface: 'agent', backend: 'native' })).backend,
        'native',
      );
      const turn = agent.session().prompt('Read the note.', { messageId: 'fixture-first' });
      const accepted = await turn.accepted;
      assert.match(accepted.sessionId, /^wrun_/);
      const events = [];
      for await (const event of turn) events.push(event);
      assert.equal((await turn.result).stopReason, 'end_turn');
      assert.equal(toolCalls, 1);
      assert.ok(events.some((event) => event.type === 'tool_start'));
      assert.ok(
        events.some(
          (event) => event.type === 'text_delta' && event.delta.includes('Fixture completed.'),
        ),
      );
      const count = fixture.requests.length;
      const repeated = await agent
        .session(accepted.sessionId)
        .prompt('Read the note.', { messageId: 'fixture-first' }).result;
      assert.equal(repeated.repeated, true);
      assert.equal(fixture.requests.length, count);

      await agent.close();
      agent = createFxAgent({ ...options, durability: local({ dir }) });
      const session = agent.session(accepted.sessionId);
      const reader = session.stream(0).getReader();
      const lines: FxStreamLine[] = [];
      const decoder = new TextDecoder();
      let buffer = '';
      while (!lines.some((line) => line.type === 'turn_end')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop()!;
        for (const part of parts) if (part) lines.push(JSON.parse(part));
      }
      await reader.cancel();
      assert.ok(lines.every((line) => typeof line.cursor === 'number'));
      assert.equal(
        fixture.requests.length,
        count,
        'replaying a transcript makes no inference request',
      );
      const followup = session.prompt('Read the note again.', { messageId: 'fixture-second' });
      assert.equal((await followup.result).stopReason, 'end_turn');
      assert.ok(fixture.requests.at(-1)!.messages.filter((m) => m.role === 'user').length >= 2);
    } finally {
      await agent.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'compatible-provider credentials stay outside durable history and viewer detach keeps the turn running',
  { timeout: 10_000 },
  async () => {
    const fixture = await startModelFixture({ delayMs: 150 }),
      dir = await mkdtemp(join(tmpdir(), 'slim-credentials-'));
    const secret = 'synthetic-key-not-for-persistence';
    const agent = createFxAgent({
      name: 'credential-proof',
      provider: {
        name: 'credentialfixture',
        baseUrl: fixture.url,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      model: 'fixture',
      credentials: async () => ({ apiKey: secret }),
      durability: local({ dir }),
    });
    try {
      const session = agent.session(),
        turn = session.prompt('A synthetic request.');
      await turn.accepted;
      const reader = session.stream().getReader();
      await reader.read();
      await reader.cancel();
      assert.equal((await turn.result).stopReason, 'end_turn');
      await agent.close();
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile())
          assert.ok(
            !(await readFile(join(entry.parentPath, entry.name))).includes(Buffer.from(secret)),
            'the model credential must stay outside durable history',
          );
      }
    } finally {
      await agent.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
