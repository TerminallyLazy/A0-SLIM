import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { startModelFixture } from './helpers/model-server.js';

test(
  'local API enforces pairing, host/origin checks, private roots and a real persisted conversation',
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-api-')),
      projectRoot = join(dir, 'project');
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, 'README.md'), 'fixture');
    const fixture = await startModelFixture({ tool: 'list_dir', delayMs: 150 });
    const origin = 'http://127.0.0.1:4310';
    const { app, store, runtime } = await createApp({
      dataDir: join(dir, '..private'),
      origin,
      pairingCode: 'test-pairing',
      keySource: async () => Buffer.alloc(32, 5),
    });
    let cookie = '';
    const call = (
      method: 'GET' | 'POST',
      url: string,
      payload?: unknown,
      extra: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: { host: '127.0.0.1:4310', origin, cookie, ...extra },
        ...(payload === undefined
          ? {}
          : {
              payload: JSON.stringify(payload),
              headers: {
                host: '127.0.0.1:4310',
                origin,
                cookie,
                'content-type': 'application/json',
                ...extra,
              },
            }),
      });
    try {
      assert.equal((await call('GET', '/state')).statusCode, 401);
      assert.equal(
        (await call('POST', '/pair', { code: 'test-pairing' }, { origin: 'https://evil.test' }))
          .statusCode,
        403,
      );
      assert.equal(
        (await call('GET', '/status', undefined, { host: 'evil.test' })).statusCode,
        403,
      );
      const paired = await call('POST', '/pair', { code: 'test-pairing' });
      assert.equal(paired.statusCode, 200);
      cookie = String(paired.headers['set-cookie']).split(';')[0]!;
      assert.match(String(paired.headers['set-cookie']), /HttpOnly/);
      assert.match(String(paired.headers['set-cookie']), /SameSite=Strict/);
      assert.equal((await call('POST', '/pair', { code: 'test-pairing' })).statusCode, 401);
      assert.equal(
        (await call('POST', '/projects', { name: 'private', root: dir })).statusCode,
        403,
      );
      const project = (
        await call('POST', '/projects', { name: 'Fixture', root: projectRoot })
      ).json();
      const connection = (
        await call('POST', '/connections', {
          name: 'Fixture model',
          kind: 'compatible',
          model: 'fixture',
          baseUrl: fixture.url,
          apiKey: 'synthetic-key',
        })
      ).json();
      const state = await call('GET', '/state');
      assert.ok(!state.body.includes('synthetic-key'));
      assert.ok(!state.body.includes('ciphertext'));
      assert.equal(
        (await call('GET', `/projects/${project.id}/files?read=true&path=../data/a0-slim.db`))
          .statusCode,
        403,
      );
      const chat = (
        await call('POST', '/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'A fixture conversation',
        })
      ).json();
      assert.equal(
        fixture.requests.length,
        0,
        'draft selection and chat creation do not run inference',
      );
      const messageId = randomUUID();
      const started = await call('POST', `/chats/${chat.id}/messages`, {
        text: 'List the files.',
        messageId,
      });
      assert.equal(started.statusCode, 200, started.body);
      assert.equal(
        (
          await call('POST', `/chats/${chat.id}/messages`, {
            text: 'Overlap',
            messageId: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const reader = (await runtime.stream(chat.id, 0)).getReader(),
        decoder = new TextDecoder();
      let text = '';
      while (!text.includes('turn_end')) {
        const part = await reader.read();
        text += decoder.decode(part.value);
      }
      await reader.cancel();
      const events = text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.ok(events.some((e) => e.type === 'text_delta'));
      assert.ok(events.some((e) => e.type === 'tool_start'));
      assert.equal(events.find((e) => e.type === 'turn_start').input, 'List the files.');
      for (let i = 0; i < 50 && store.chat(chat.id).status === 'running'; i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal(store.chat(chat.id).status, 'idle');
      const count = fixture.requests.length;
      assert.equal(
        (await call('POST', `/chats/${chat.id}/messages`, { text: 'List the files.', messageId }))
          .statusCode,
        200,
      );
      assert.equal(fixture.requests.length, count);
      const cursor = events.at(-1).cursor;
      const reconnect = (await runtime.stream(chat.id, cursor)).getReader();
      // Cancel the viewer independently; this must not cancel a future turn.
      await reconnect.cancel();
    } finally {
      await app.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
