import { randomBytes, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Connection } from '../domain.js';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from './vault.js';

const issuer = 'https://auth.openai.com';
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = 'https://api.openai.com/v1';
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
type TokenSet = {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
  reconnectRequired?: boolean;
};
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  connectionId?: string;
  clientId: string;
};
export class ChatGPTAccounts {
  private attempts = new Map<string, Pending>();
  private refreshes = new Map<string, Promise<string>>();
  private disconnecting = new Set<string>();
  private jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  constructor(
    private store: Store,
    private vault: Vault,
    private transport: typeof fetch = fetch,
    private verifyIdentity?: (token: string, clientId: string) => Promise<JWTPayload>,
  ) {}

  start(origin: string, connectionId?: string) {
    const connection = connectionId ? this.store.connection(connectionId) : undefined;
    if (connection && (connection.kind !== 'chatgpt' || !connection.account))
      throw new AppError(400, 'invalid_account', 'Choose a registered ChatGPT account.');
    for (const [key, pending] of this.attempts)
      if (pending.expiresAt < Date.now()) this.attempts.delete(key);
    if (this.attempts.size >= 5)
      throw new AppError(
        429,
        'auth_pending',
        'Finish or wait for the existing sign-in attempts to expire.',
      );
    const state = randomBytes(32).toString('base64url');
    const pending: Pending = {
      state,
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(48).toString('base64url'),
      redirectUri: `${origin}/auth/callback`,
      expiresAt: Date.now() + 10 * 60_000,
      clientId: connection?.account?.clientId ?? 'dynamic_agent_client',
      connectionId,
    };
    this.attempts.set(state, pending);
    const url = new URL(`${issuer}/api/accounts/authorize`);
    const params: Record<string, string> = {
      client_id: pending.clientId,
      ext_agent_host_id: this.store.meta('host_id')!,
      response_type: 'code',
      redirect_uri: pending.redirectUri,
      scope: scopes,
      resource,
      state,
      nonce: pending.nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'),
    };
    if (!connection) params.agent_name_hint = 'A0 SLIM';
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return { url: url.href, expiresAt: pending.expiresAt };
  }

  async finish(query: URLSearchParams) {
    const state = query.get('state') ?? '';
    const pending = this.attempts.get(state);
    if (
      !pending ||
      state.length !== pending.state.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) ||
      pending.expiresAt < Date.now()
    )
      throw new AppError(
        400,
        'auth_expired',
        'This sign-in expired or belongs to another attempt. Start again in A0 SLIM.',
      );
    this.attempts.delete(state);
    if (query.has('error'))
      throw new AppError(
        400,
        'auth_denied',
        'ChatGPT sign-in was not completed. You can try again from Connections.',
      );
    const code = query.get('code');
    const clientId =
      query.get('client_id') ??
      (pending.clientId === 'dynamic_agent_client' ? '' : pending.clientId);
    if (
      !code ||
      !clientId ||
      clientId === 'dynamic_agent_client' ||
      (pending.connectionId && clientId !== pending.clientId)
    )
      throw new AppError(
        400,
        'auth_identity',
        'The registration callback did not match this account.',
      );
    const response = await this.transport(tokenEndpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource,
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        400,
        'auth_exchange',
        'ChatGPT could not complete sign-in. Start a new attempt.',
      );
    }
    const token = (await response.json()) as Record<string, unknown>;
    if (typeof token.id_token !== 'string')
      throw new AppError(400, 'auth_identity', 'The account did not return a verifiable identity.');
    const payload = this.verifyIdentity
      ? await this.verifyIdentity(token.id_token, clientId)
      : (await jwtVerify(token.id_token, this.jwks, { issuer, audience: clientId })).payload;
    if (payload.nonce !== pending.nonce || !payload.sub || !payload.exp)
      throw new AppError(400, 'auth_identity', 'The returned identity did not match this sign-in.');
    const previous = pending.connectionId ? this.store.connection(pending.connectionId) : undefined;
    if (previous && previous.account?.subject !== payload.sub)
      throw new AppError(
        400,
        'auth_identity',
        'A different account signed in. Add it as a separate connection.',
      );
    const credential = this.normalize(token);
    const id = previous?.id ?? randomUUID();
    const connection: Connection = {
      id,
      kind: 'chatgpt',
      name: previous?.name ?? 'ChatGPT',
      model: previous?.model ?? '',
      contextWindow: 32768,
      hasCredential: true,
      verifiedAt: null,
      account: {
        subject: payload.sub,
        clientId,
        label:
          typeof payload.email === 'string'
            ? payload.email
            : `ChatGPT account ${clientId.slice(-6)}`,
      },
    };
    await this.vault.set(id, credential);
    this.store.saveConnection(connection);
    return connection;
  }

  private normalize(token: Record<string, unknown>, previous?: TokenSet): TokenSet {
    const granted =
      typeof token.scope === 'string' ? token.scope.split(' ') : (previous?.scopes ?? []);
    if (!granted.includes('chatgpt.tokens.use.direct'))
      throw new AppError(
        403,
        'plan_permission_missing',
        'ChatGPT plan usage was not granted for this connection.',
      );
    if (
      typeof token.access_token !== 'string' ||
      (!previous && typeof token.refresh_token !== 'string') ||
      typeof token.expires_in !== 'number' ||
      token.expires_in <= 0
    )
      throw new AppError(400, 'auth_tokens', 'ChatGPT returned an incomplete token set.');
    return {
      accessToken: token.access_token,
      refreshToken:
        typeof token.refresh_token === 'string' ? token.refresh_token : previous!.refreshToken,
      idToken: typeof token.id_token === 'string' ? token.id_token : (previous?.idToken ?? ''),
      scopes: granted,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
  }

  async accessToken(id: string) {
    if (this.disconnecting.has(id))
      throw new AppError(401, 'reconnect_required', 'This account is being disconnected.');
    const current = await this.vault.get<TokenSet>(id);
    if (this.disconnecting.has(id))
      throw new AppError(401, 'reconnect_required', 'This account is being disconnected.');
    if (!current || current.reconnectRequired)
      throw new AppError(401, 'reconnect_required', 'Reconnect this ChatGPT account.');
    if (current.expiresAt > Date.now() + 60_000) return current.accessToken;
    const existing = this.refreshes.get(id);
    if (existing) return existing;
    const refresh = (async () => {
      const latest = (await this.vault.get<TokenSet>(id))!;
      const connection = this.store.connection(id);
      const response = await this.transport(tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: connection.account!.clientId,
          refresh_token: latest.refreshToken,
          resource,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 400 || response.status === 401)
          await this.vault.set(id, { ...latest, reconnectRequired: true });
        throw new AppError(
          response.status >= 500 ? 503 : 401,
          'refresh_failed',
          'ChatGPT could not renew this account connection.',
        );
      }
      const replacement = this.normalize(
        (await response.json()) as Record<string, unknown>,
        latest,
      );
      await this.vault.set(id, replacement);
      return replacement.accessToken;
    })();
    this.refreshes.set(id, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshes.delete(id);
    }
  }

  async models(id: string) {
    const response = await this.transport(`${resource}/models`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${await this.accessToken(id)}` },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(502, 'catalog_failed', 'Could not load this account’s models.');
    }
    const body = (await response.json()) as {
      models?: Array<{ slug: string; display_name: string; visibility: string }>;
    };
    return (body.models ?? [])
      .filter((model) => model.visibility === 'list')
      .map((model) => ({ id: model.slug, name: model.display_name }));
  }

  async disconnect(id: string) {
    this.disconnecting.add(id);
    for (const [key, attempt] of this.attempts)
      if (attempt.connectionId === id) this.attempts.delete(key);
    try {
      await this.refreshes.get(id)?.catch(() => {});
      const connection = this.store.connection(id);
      const tokens = await this.vault.get<TokenSet>(id);
      let revoked = !tokens;
      if (tokens) {
        try {
          const response = await this.transport(`${issuer}/api/accounts/oauth/revoke`, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: tokens.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: connection.account!.clientId,
            }),
          });
          revoked = response.status === 200;
          await response.body?.cancel();
        } catch {
          revoked = false;
        }
      }
      this.vault.remove(id);
      this.store.saveConnection({ ...connection, hasCredential: false, verifiedAt: null });
      return {
        revoked,
        message: revoked
          ? 'Disconnected.'
          : 'Disconnected locally. Remote revocation was not confirmed; review access in ChatGPT Settings.',
      };
    } finally {
      this.disconnecting.delete(id);
    }
  }
}
