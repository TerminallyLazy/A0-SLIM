import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { AppError, connectionInput, safeEndpoint } from '../domain.js';
import { Store } from '../storage/store.js';
import { Vault, systemKeySource } from '../providers/vault.js';
import { ChatGPTAccounts } from '../providers/chatgpt.js';
import { Coordinator } from '../runtime/coordinator.js';
import { SandboxProof } from '../execution/proof.js';
import { listWorkspace, readWorkspaceFile } from '../tools/files.js';

const idParams = z.object({ id: z.string().uuid() });
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createApp(options: {
  dataDir: string;
  origin: string;
  pairingCode: string;
  staticDir?: string;
  keySource?: () => Promise<Buffer>;
}) {
  const origin = new URL(options.origin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:')
    throw new Error('A0 SLIM must listen on IPv4 loopback.');
  const app = Fastify({ logger: false, bodyLimit: 300_000, requestTimeout: 30_000 });
  const store = new Store(options.dataDir);
  const vault = new Vault(store, options.keySource ?? systemKeySource(store.dir));
  const accounts = new ChatGPTAccounts(store, vault);
  const runtime = new Coordinator(store, vault, accounts);
  const sandbox = new SandboxProof(store, vault);
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const session = randomBytes(32).toString('hex');
  let pairing: string | null = options.pairingCode,
    attempts = 0;
  const expires = Date.now() + 10 * 60_000;
  const sessionExpiry = Date.now() + 8 * 60 * 60_000;
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (request.headers.host !== origin.host)
      throw new AppError(403, 'invalid_host', 'Use the local A0 SLIM address.');
    if (request.headers.origin && request.headers.origin !== origin.origin)
      throw new AppError(403, 'invalid_origin', 'This request came from another origin.');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.origin !== origin.origin)
      throw new AppError(403, 'origin_required', 'A same-origin browser request is required.');
    const path = request.url.split('?')[0];
    if (path?.startsWith('/api/') && path !== '/api/v1/pair' && path !== '/api/v1/status') {
      if (Date.now() > sessionExpiry || !equal(request.cookies.slim_session ?? '', session))
        throw new AppError(
          401,
          'pair_required',
          'Pair this browser using the code in your terminal.',
        );
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.status).send({ error: error.code, message: error.message });
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: 'invalid_input', message: 'Check the required fields and try again.' });
    return reply
      .code(500)
      .send({
        error: 'operation_failed',
        message: 'The operation could not be completed. Check your connection and try again.',
      });
  });
  app.get('/api/v1/status', async (request) => ({
    paired: Date.now() <= sessionExpiry && equal(request.cookies.slim_session ?? '', session),
    stage: 'P0 foundation',
    version: '0.1.0-alpha.0',
  }));
  app.post('/api/v1/pair', async (request, reply) => {
    const { code } = z.object({ code: z.string().max(100) }).parse(request.body);
    if (++attempts > 8 || !pairing || Date.now() > expires || !equal(code, pairing))
      throw new AppError(
        401,
        'pair_failed',
        'Pairing code invalid, used, or expired. Restart the local service for a new code.',
      );
    pairing = null;
    reply.setCookie('slim_session', session, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 8 * 60 * 60,
    });
    return { ok: true };
  });
  app.get('/api/v1/state', async () => ({
    projects: store.projects(),
    chats: store.chats(),
    connections: store.connections(),
    receipts: store.receipts(),
    sandboxConfigured: store.meta('sandbox:vercel') === 'configured',
  }));
  app.post('/api/v1/projects', async (request) => {
    const input = z
      .object({ name: z.string().trim().min(1).max(80), root: z.string().min(1).max(2048) })
      .strict()
      .parse(request.body);
    if (!isAbsolute(input.root))
      throw new AppError(400, 'project_path', 'Enter an absolute folder path.');
    const root = await realpath(input.root),
      data = await realpath(store.dir);
    if (!(await stat(root)).isDirectory())
      throw new AppError(400, 'project_path', 'Choose a folder.');
    const contains = (parent: string, child: string) => {
      const rel = relative(parent, child);
        return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
    };
    if (contains(root, data) || contains(data, root))
      throw new AppError(
        403,
        'private_data',
        'Choose a project folder separate from A0 SLIM’s private data.',
      );
    const project = { id: randomUUID(), name: input.name, root };
    store.saveProject(project);
    return project;
  });
  app.get('/api/v1/projects/:id/files', async (request) => {
    const { id } = idParams.parse(request.params),
      { path, read } = z
        .object({ path: z.string().max(2048).default('.'), read: z.enum(['true']).optional() })
        .parse(request.query);
    const project = store.project(id);
    return read
      ? { text: await readWorkspaceFile(project.root, path) }
      : { entries: await listWorkspace(project.root, path) };
  });
  app.post('/api/v1/connections', async (request) => {
    const input = connectionInput.parse(request.body);
    if (input.kind === 'gateway' && !input.apiKey)
      throw new AppError(400, 'key_required', 'An AI Gateway key is required.');
    const baseUrl = input.kind === 'compatible' ? safeEndpoint(input.baseUrl ?? '') : undefined;
    const id = randomUUID();
    if (input.apiKey) await vault.set(id, { apiKey: input.apiKey });
    const connection = {
      id,
      name: input.name,
      kind: input.kind,
      baseUrl,
      model: input.model,
      contextWindow: input.contextWindow,
      hasCredential: !!input.apiKey,
      verifiedAt: null,
    };
    store.saveConnection(connection);
    return connection;
  });
  app.post('/api/v1/chatgpt/start', async (request) => {
    const input = z
      .object({ connectionId: z.string().uuid().optional() })
      .strict()
      .parse(request.body);
    return accounts.start(origin.origin, input.connectionId);
  });
  app.get('/auth/callback', async (request, reply) => {
    try {
      await accounts.finish(new URL(request.url, origin).searchParams);
      return reply.redirect('/?connection=added');
    } catch {
      return reply.redirect('/?connection=failed');
    }
  });
  app.get('/api/v1/connections/:id/models', async (request) =>
    accounts.models(idParams.parse(request.params).id),
  );
  app.post('/api/v1/connections/:id/model', async (request) => {
    const { id } = idParams.parse(request.params),
      { model } = z.object({ model: z.string().min(1).max(200) }).parse(request.body);
    const connection = store.connection(id);
    if (
      connection.kind !== 'chatgpt' ||
      !(await accounts.models(id)).some((item) => item.id === model)
    )
      throw new AppError(400, 'invalid_model', 'Choose a model from this account’s catalog.');
    store.saveConnection({ ...connection, model });
    return { ok: true };
  });
  app.post('/api/v1/connections/:id/disconnect', async (request) => {
    const { id } = idParams.parse(request.params);
    const connection = store.connection(id);
    await runtime.disconnect(id);
    if (connection.kind === 'chatgpt') return accounts.disconnect(id);
    throw new AppError(
      400,
      'unsupported_action',
      'Disconnect is currently available for ChatGPT accounts.',
    );
  });
  app.post('/api/v1/chats', async (request) => {
    const input = z
      .object({
        projectId: z.string().uuid(),
        connectionId: z.string().uuid(),
        title: z.string().trim().min(1).max(100),
      })
      .strict()
      .parse(request.body);
    store.project(input.projectId);
    const connection = store.connection(input.connectionId);
    if (!connection.model) throw new AppError(400, 'model_missing', 'Select a model first.');
    const chat = {
      id: randomUUID(),
      ...input,
      model: connection.model,
      sessionId: null,
      status: 'idle' as const,
      createdAt: new Date().toISOString(),
    };
    store.saveChat(chat);
    return chat;
  });
  app.post('/api/v1/chats/:id/messages', async (request) => {
    const { id } = idParams.parse(request.params),
      input = z
        .object({ text: z.string().trim().min(1).max(32000), messageId: z.string().uuid() })
        .strict()
        .parse(request.body);
    return runtime.prompt(id, input.text, input.messageId);
  });
  app.post('/api/v1/chats/:id/cancel', async (request) => {
    await runtime.cancel(idParams.parse(request.params).id);
    return { ok: true };
  });
  app.post('/api/v1/chats/:id/resume', async (request) =>
    runtime.resume(idParams.parse(request.params).id),
  );
  app.get('/api/v1/chats/:id/events', async (request, reply) => {
    const { id } = idParams.parse(request.params),
      { cursor } = z
        .object({ cursor: z.coerce.number().int().nonnegative().default(0) })
        .parse(request.query);
    const source = await runtime.stream(id, cursor);
    const reader = source.getReader();
    readers.add(reader);
    const stop = () => {
      void reader.cancel().catch(() => {});
    };
    reply.raw.on('close', stop);
    async function* events() {
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          pending += decoder.decode(part.value, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop()!;
          for (const line of lines)
            if (line) {
              const event = JSON.parse(line) as Record<string, unknown>;
              // Provider failures can contain credential-bearing URLs; retain only a safe notice.
              if (event.type === 'turn_end' && event.error)
                event.error = 'This turn did not complete. Check the connection before retrying.';
              yield JSON.stringify({ version: 1, chatId: id, cursor: event.cursor, event }) + '\n';
            }
        }
      } finally {
        readers.delete(reader);
        reply.raw.off('close', stop);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return reply
      .type('application/x-ndjson')
      .header('x-accel-buffering', 'no')
      .send(Readable.from(events()));
  });
  app.post('/api/v1/sandbox/vercel', async (request) => {
    const input = z
      .object({
        token: z.string().min(1).max(8192),
        teamId: z.string().min(1).max(200),
        projectId: z.string().min(1).max(200),
      })
      .strict()
      .parse(request.body);
    await vault.set('sandbox:vercel', input);
    store.setMeta('sandbox:vercel', 'configured');
    return { ok: true };
  });
  app.post('/api/v1/sandbox/vercel/proof', async (request) => {
    z.object({ acknowledgeUsage: z.literal(true) })
      .strict()
      .parse(request.body);
    return sandbox.run();
  });
  if (options.staticDir && existsSync(options.staticDir)) {
    await app.register(serveStatic, { root: resolve(options.staticDir), index: ['index.html'] });
  }
  app.addHook('preClose', async () => {
    await Promise.allSettled([...readers].map((reader) => reader.cancel()));
  });
  app.addHook('onClose', async () => {
    await runtime.close();
    store.close();
  });
  return { app, store, vault, runtime };
}
