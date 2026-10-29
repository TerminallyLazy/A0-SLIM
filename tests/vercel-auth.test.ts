import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { AppError } from '../src/domain.js';
import { SandboxProof } from '../src/execution/proof.js';
import {
  verifyVercelScope,
  vercelCredentials,
  vercelFailure,
} from '../src/execution/vercel-auth.js';
import { createApp } from '../src/server/app.js';

const credentials = { token: 'synthetic-secret', teamId: 'fixture-team', projectId: 'prj_fixture' };
test('Vercel connection IDs survive reopening while token remains write-only and blank updates retain it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-config-')),
    origin = 'http://127.0.0.1:4319';
  const fixture = await createApp({
    dataDir: dir,
    origin,
    pairingCode: 'fixture',
    keySource: async () => Buffer.alloc(32, 6),
  });
  try {
    const paired = await fixture.app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers: { host: '127.0.0.1:4319', origin },
      payload: { code: 'fixture' },
    });
    const cookie = paired.cookies[0]!;
    const headers = { host: '127.0.0.1:4319', origin, cookie: `${cookie.name}=${cookie.value}` };
    const path = '/api/v1/sandbox/vercel';
    assert.equal(
      (await fixture.app.inject({ method: 'POST', url: path, headers, payload: credentials }))
        .statusCode,
      200,
    );
    const saved = await fixture.app.inject({ url: path + '/connection', headers });
    assert.deepEqual(saved.json(), {
      teamId: credentials.teamId,
      projectId: credentials.projectId,
      hasToken: true,
    });
    assert.ok(!saved.body.includes(credentials.token));
    assert.equal(
      (
        await fixture.app.inject({
          method: 'POST',
          url: path,
          headers,
          payload: { ...credentials, token: '', projectId: 'prj_updated' },
        })
      ).statusCode,
      200,
    );
    const stored = await new Vault(fixture.store, async () => Buffer.alloc(32, 6)).get<{
      token: string;
      projectId: string;
    }>('sandbox:vercel');
    assert.equal(stored?.token, credentials.token);
    assert.equal(stored?.projectId, 'prj_updated');
    assert.equal(
      (await fixture.app.inject({ url: path + '/connection', headers: { host: '127.0.0.1:4319' } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await fixture.app.inject({
          method: 'POST',
          url: path + '/receipts/00000000-0000-4000-8000-000000000000/review-absence',
          headers,
          payload: { resolution: 'User checked provider.' },
        })
      ).statusCode,
      400,
    );
  } finally {
    await fixture.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('Vercel resolves a slug with app-owned credentials and verifies project and team ownership', async () => {
  const urls: URL[] = [];
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    urls.push(url);
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic-secret');
    assert.equal(options?.redirect, 'error');
    return Response.json(
      url.pathname.startsWith('/v9/projects/')
        ? { id: credentials.projectId, accountId: 'team_fixture' }
        : { id: 'team_fixture', slug: credentials.teamId },
    );
  };
  assert.equal((await verifyVercelScope(credentials, transport)).teamId, 'team_fixture');
  assert.equal(urls[0]!.searchParams.get('slug'), 'fixture-team');
  assert.equal(urls.length, 1, 'project-scoped tokens need no team-management permission');
  await assert.rejects(
    verifyVercelScope({ ...credentials, teamId: 'team_other' }, transport),
    /different Vercel team/,
  );
  await assert.rejects(
    verifyVercelScope(credentials, async () =>
      Response.json({ id: 'prj_other', accountId: 'team_fixture' }),
    ),
    /ownership/,
  );
  await assert.rejects(
    verifyVercelScope(
      credentials,
      async () => new Response('secret-provider-error', { status: 403 }),
    ),
    /denied access/,
  );
  assert.equal(
    vercelCredentials.safeParse({ ...credentials, teamId: 'https://example.com' }).success,
    false,
  );
  assert.equal(
    vercelCredentials.safeParse({ ...credentials, projectId: 'project-name' }).success,
    false,
  );
  assert.ok(!vercelFailure(new Error('synthetic-secret')).includes('synthetic-secret'));
});

test('Vercel preflight failures never dispatch creation or leave an unknown creation receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-access-')),
    store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 6));
  await vault.set('sandbox:vercel', credentials);
  let creates = 0;
  try {
    const proof = new SandboxProof(
      store,
      vault,
      async () => {
        creates++;
        throw new Error('must not create');
      },
      undefined,
      async () => {
        throw new AppError(400, 'vercel_access', 'Vercel denied access.');
      },
    );
    for (let i = 0; i < 2; i++) {
      const receipt = await proof.run();
      assert.equal(receipt.cleanup, 'not_created');
      assert.equal(receipt.status, 'failed');
    }
    assert.equal(creates, 0);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Vercel missing-resource review requires original scope, elapsed lifetime, exact absence and complete listing; preserves failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-review-')),
    store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 6));
  await vault.set('sandbox:vercel', credentials);
  let creates = 0,
    absenceVerified = false,
    lookupStatus = 404;
  const proof = new SandboxProof(
    store,
    vault,
    async () => {
      creates++;
      throw new Error('lost create response');
    },
    async () => {
      throw { response: new Response(null, { status: lookupStatus }) };
    },
    async (c) => ({ ...c, teamId: c.teamId === 'fixture-team' ? 'team_fixture' : c.teamId }),
    async () => {
      if (!absenceVerified) throw new Error('unavailable listing with synthetic-secret');
    },
  );
  try {
    const receipt = await proof.run();
    assert.equal(
      (await proof.reconcile(receipt.id)).cleanup,
      'unknown',
      'ordinary 404 never releases hold',
    );
    await assert.rejects(
      proof.reviewAbsence(receipt.id, 'Checked this exact resource in the provider dashboard.'),
      /recorded session timeout/,
    );
    receipt.startedAt = new Date(Date.now() - Number(receipt.lifetimeMs) - 1_000).toISOString();
    store.receipt(receipt);
    await assert.rejects(
      proof.reviewAbsence(receipt.id, 'Checked this exact resource in the provider dashboard.'),
      /did not confirm/,
    );
    assert.equal(store.receipts()[0]!.cleanup, 'unknown');
    absenceVerified = true;
    lookupStatus = 403;
    await assert.rejects(
      proof.reviewAbsence(receipt.id, 'Checked this exact resource in the provider dashboard.'),
      /denied access/,
    );
    lookupStatus = 404;
    await vault.set('sandbox:vercel', { ...credentials, projectId: 'prj_other' });
    await assert.rejects(
      proof.reviewAbsence(receipt.id, 'Checked this exact resource in the provider dashboard.'),
      /original Vercel/,
    );
    await vault.set('sandbox:vercel', credentials);
    const reviewed = await proof.reviewAbsence(
      receipt.id,
      'Checked this exact resource and complete project listing; no sandbox remains.',
    );
    assert.equal(reviewed.cleanup, 'reviewed_absent');
    assert.equal(reviewed.status, 'failed');
    assert.deepEqual(reviewed.scope, { teamId: 'team_fixture', projectId: 'prj_fixture' });
    assert.equal(creates, 1);
    assert.ok(!JSON.stringify(store.receipts()).includes(credentials.token));
    await proof.run();
    assert.equal(creates, 2, 'new creation permitted only after explicit review');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const origin of ['https://api.vercel.com', 'https://vercel.com/api'])
  test(`Vercel SDK creation retries cannot issue a second resource request at ${origin}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-vercel-retry-')),
      store = new Store(dir),
      vault = new Vault(store, async () => Buffer.alloc(32, 6));
    await vault.set('sandbox:vercel', credentials);
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Response(null, { status: 503 });
    };
    try {
      const proof = new SandboxProof(
        store,
        vault,
        async (options) => {
          const transport = options!.fetch!;
          assert.equal((await transport(`${origin}/v3/sandboxes`, { method: 'POST' })).status, 503);
          await assert.rejects(
            transport(`${origin}/v3/sandboxes`, { method: 'POST' }),
            /not be retried/,
          );
          throw new Error('ambiguous creation');
        },
        undefined,
        async (c) => c,
      );
      assert.equal((await proof.run()).cleanup, 'unknown');
      assert.equal(requests, 1);
    } finally {
      globalThis.fetch = original;
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
