import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { ChatGPTAccounts } from '../src/providers/chatgpt.js';

test('ChatGPT registration binds PKCE, nonce and issued client; refresh is serialized and disconnect clears custody', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-auth-'));
  const store = new Store(dir);
  const vault = new Vault(store, async () => Buffer.alloc(32, 4));
  let nonce = '',
    refreshCount = 0,
    revoked = false;
  const requests: URLSearchParams[] = [];
  const transport: typeof fetch = async (url, init) => {
    const data = new URLSearchParams(String(init?.body));
    requests.push(data);
    if (String(url).endsWith('/revoke')) {
      revoked = true;
      return new Response('', { status: 200 });
    }
    const refreshing = data.get('grant_type') === 'refresh_token';
    if (refreshing) {
      refreshCount++;
      await new Promise((r) => setTimeout(r, 20));
    }
    return Response.json({
      access_token: refreshing ? 'refreshed-access' : 'initial-access',
      refresh_token: refreshing ? 'rotated-refresh' : 'initial-refresh',
      id_token: 'signed-fixture',
      expires_in: refreshing ? 3600 : 1,
      scope: 'openid chatgpt.tokens.use.direct',
    });
  };
  // Production uses jose/JWKS verification. The test seam supplies already-verified claims.
  const accounts = new ChatGPTAccounts(store, vault, transport, async (_jwt, clientId) => {
    assert.equal(clientId, 'issued-client');
    return { sub: 'subject-one', exp: Math.floor(Date.now() / 1000) + 3600, nonce };
  });
  try {
    const start = new URL(accounts.start('http://127.0.0.1:4310').url);
    nonce = start.searchParams.get('nonce')!;
    assert.equal(start.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(start.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(start.searchParams.get('redirect_uri'), 'http://127.0.0.1:4310/auth/callback');
    await assert.rejects(
      accounts.finish(
        new URLSearchParams({ state: 'wrong', code: 'code', client_id: 'issued-client' }),
      ),
    );
    const callback = new URLSearchParams({
      state: start.searchParams.get('state')!,
      code: 'code',
      client_id: 'issued-client',
    });
    const connection = await accounts.finish(callback);
    assert.equal(connection.account?.subject, 'subject-one');
    assert.equal(requests[0]!.get('client_id'), 'issued-client');
    assert.ok(requests[0]!.get('code_verifier'));
    await assert.rejects(accounts.finish(callback));
    const values = await Promise.all(
      Array.from({ length: 6 }, () => accounts.accessToken(connection.id)),
    );
    assert.ok(values.every((value) => value === 'refreshed-access'));
    assert.equal(refreshCount, 1);
    assert.equal((await vault.get<any>(connection.id)).refreshToken, 'rotated-refresh');
    const returning = new URL(accounts.start('http://127.0.0.1:4310', connection.id).url);
    assert.equal(returning.searchParams.get('client_id'), 'issued-client');
    assert.equal(returning.searchParams.get('agent_name_hint'), null);
    await accounts.disconnect(connection.id);
    assert.equal(revoked, true);
    assert.equal(await vault.get(connection.id), null);
    await assert.rejects(accounts.accessToken(connection.id), /Reconnect/);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
