import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app.js';
import { startModelFixture } from './helpers/model-server.js';

test(
  'host Bash requires paired explicit opt-in, freezes new-chat grants, and completes a native tool round trip',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-bash-api-')),
      root = join(dir, 'project');
    await mkdir(root);
    const fixture = await startModelFixture({
      tool: 'bash',
      toolInput: { command: 'printf result > result.txt; cat result.txt', target: 'host' },
    });
    const origin = 'http://127.0.0.1:4310';
    const { app, store } = await createApp({
      dataDir: join(dir, 'data'),
      origin,
      pairingCode: 'fixture',
      keySource: async () => Buffer.alloc(32, 9),
    });
    let cookie = '';
    const call = (path: string, payload?: Record<string, unknown>, override?: string) =>
      app.inject({
        method: payload === undefined ? 'GET' : 'POST',
        url: '/api/v1' + path,
        headers: { host: '127.0.0.1:4310', origin: override ?? origin, cookie },
        ...(payload === undefined ? {} : { payload }),
      });
    try {
      assert.equal((await call('/bash')).statusCode, 401);
      cookie = String((await call('/pair', { code: 'fixture' })).headers['set-cookie']).split(
        ';',
      )[0]!;
      const project = (await call('/projects', { name: 'Bash fixture', root })).json();
      assert.equal((await call(`/projects/${project.id}/bash`, { enabled: true })).statusCode, 400);
      assert.equal(
        (
          await call(
            `/projects/${project.id}/bash`,
            { enabled: true, acknowledgeHostAccess: true },
            'https://evil.test',
          )
        ).statusCode,
        403,
      );
      const connection = (
        await call('/connections', {
          name: 'fixture',
          kind: 'compatible',
          baseUrl: fixture.url,
          model: 'fixture',
        })
      ).json();
      const old = (
        await call('/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'Before permission',
        })
      ).json();
      assert.equal(old.hostBashRevision, undefined);
      assert.equal(
        (await call(`/projects/${project.id}/bash`, { enabled: true, acknowledgeHostAccess: true }))
          .statusCode,
        200,
      );
      const chat = (
        await call('/chats', {
          projectId: project.id,
          connectionId: connection.id,
          title: 'Bash fixture',
        })
      ).json();
      assert.ok(chat.hostBashRevision);
      assert.equal(chat.bashVersion, 1);
      assert.equal(
        (
          await call(`/chats/${chat.id}/messages`, {
            text: 'Run the synthetic script.',
            messageId: randomUUID(),
          })
        ).statusCode,
        200,
      );
      for (let i = 0; i < 300 && store.chat(chat.id).status === 'running'; i++)
        await new Promise((r) => setTimeout(r, 25));
      assert.equal(store.chat(chat.id).status, 'idle');
      const receipt = store.receipts().find((r) => r.kind === 'bash')!;
      assert.equal(receipt.status, 'passed');
      assert.equal(receipt.stdout, 'result');
      assert.equal(await readFile(join(root, 'result.txt'), 'utf8'), 'result');
      const requests = JSON.stringify(fixture.requests);
      assert.ok(requests.includes('bash'));
      assert.ok(!requests.includes('Arbitrary shell execution is unavailable.'));
      assert.equal(
        (await call(`/projects/${project.id}/bash`, { enabled: false })).statusCode,
        200,
      );
      assert.equal(store.project(project.id).hostBashGrant, undefined);
    } finally {
      await app.close();
      await fixture.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
