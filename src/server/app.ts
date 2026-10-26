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
import { vercelCredentials } from '../execution/vercel-auth.js';
import { environmentStatus } from '../execution/status.js';
import { ModalProof, modalCredentials } from '../execution/modal.js';
import { CloudCheck, cloudKeyCredentials } from '../execution/cloud-check.js';
import { createE2BDriver } from '../execution/e2b.js';
import { createDaytonaDriver } from '../execution/daytona.js';
import { listWorkspace, readWorkspaceFile } from '../tools/files.js';
import { extensionRoutes } from './extensions.js';
import { ACPClient } from '../acp/client.js';
import { SpaceProof } from '../execution/space.js';

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
  const acp = new ACPClient(store);
  const chatRuntime = (id: string) => (store.chat(id).backend === 'acp' ? acp : runtime);
  const sandbox = new SandboxProof(store, vault);
  const space = new SpaceProof(store, vault);
  const modal = new ModalProof(store, vault);
  const additionalClouds = {
    e2b: new CloudCheck('e2b', store, vault, createE2BDriver),
    daytona: new CloudCheck('daytona', store, vault, createDaytonaDriver),
  };
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const saveSandboxConnection = async (provider: string, value: unknown) => {
    const previous = await vault.get(`sandbox:${provider}`);
    await vault.set(`sandbox:${provider}`, value);
    if (JSON.stringify(previous) !== JSON.stringify(value))
      store.setMeta(`sandbox:${provider}:revision`, randomUUID());
    store.setMeta(`sandbox:${provider}`, 'configured');
  };
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
    return reply.code(500).send({
      error: 'operation_failed',
      message: 'The operation could not be completed. Check your connection and try again.',
    });
  });
  app.get('/api/v1/status', async (request) => ({
    paired: Date.now() <= sessionExpiry && equal(request.cookies.slim_session ?? '', session),
    stage: 'P2 preview · account checks pending',
    version: '0.1.0-alpha.1',
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
    delegations: runtime.delegations.list().map(({ assignment, inputHash, ...record }) => record),
    connections: store.connections(),
    acp: acp.state(),
    receipts: store.receipts(),
    environments: {
      ...environmentStatus(store, {
        docker: runtime.docker.busy,
        vercel: sandbox.busy,
        modal: modal.busy,
        e2b: additionalClouds.e2b.busy,
        daytona: additionalClouds.daytona.busy,
      }),
      space: space.state().status,
    },
    artifacts: store.operations().map(({ before, content, ...item }) => item),
    sandboxConfigured: store.meta('sandbox:vercel') === 'configured',
    modalConfigured: store.meta('sandbox:modal') === 'configured',
    cloudConfigured: Object.fromEntries(
      ['vercel', 'modal', 'e2b', 'daytona'].map((id) => [
        id,
        store.meta(`sandbox:${id}`) === 'configured',
      ]),
    ),
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
  app.post('/api/v1/projects/:id/execution', async (request) => {
    const project = store.project(idParams.parse(request.params).id);
    const { execution } = z
      .object({ execution: z.enum(['none', 'docker']) })
      .strict()
      .parse(request.body);
    if (execution === 'docker' && !(await runtime.docker.availability()).available)
      throw new AppError(
        409,
        'sandbox_unavailable',
        'Start your local Docker engine and install the pinned image first.',
      );
    store.saveProject({ ...project, execution });
    return { ok: true };
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
        backend: z.enum(['acp']).optional(),
      })
      .strict()
      .parse(request.body);
    const project = store.project(input.projectId);
    if (input.backend === 'acp') {
      const profile = acp.profile(input.connectionId);
      const chat = {
        ...input,
        id: randomUUID(),
        model: profile.name,
        sessionId: null,
        status: 'idle' as const,
        createdAt: new Date().toISOString(),
      };
      store.saveChat(chat);
      return chat;
    }
    const connection = store.connection(input.connectionId);
    if (!connection.model) throw new AppError(400, 'model_missing', 'Select a model first.');
    const chat = {
      id: randomUUID(),
      ...input,
      model: connection.model,
      execution: project.execution ?? 'none',
      sessionId: null,
      capabilitiesVersion: 2 as const,
      delegationVersion: 1 as const,
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
    return chatRuntime(id).prompt(id, input.text, input.messageId);
  });
  app.post('/api/v1/chats/:id/steer', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = z
      .object({ text: z.string().trim().min(1).max(32000), messageId: z.string().uuid() })
      .strict()
      .parse(request.body);
    if (store.chat(id).backend === 'acp') return acp.steer();
    return runtime.steer(id, input.text, input.messageId);
  });
  app.get('/api/v1/artifacts/:id', async (request) =>
    store.operation(idParams.parse(request.params).id),
  );
  app.get('/api/v1/artifacts/:id/download', async (request, reply) => {
    const operation = store.operation(idParams.parse(request.params).id);
    return reply
      .type('text/plain; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(operation.path.split('/').at(-1)!)}`,
      )
      .send(operation.content);
  });
  app.post('/api/v1/artifacts/:id/apply', async (request) => {
    const { digest } = z
      .object({ digest: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(request.body);
    return runtime.operations.apply(idParams.parse(request.params).id, digest);
  });
  app.post('/api/v1/artifacts/:id/reconcile', async (request) => {
    z.object({}).strict().parse(request.body);
    return runtime.operations.reconcile(idParams.parse(request.params).id);
  });
  app.post('/api/v1/artifacts/:id/reject', async (request) => {
    const { digest, acknowledgeConflict } = z
      .object({
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        acknowledgeConflict: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    return runtime.operations.reject(
      idParams.parse(request.params).id,
      digest,
      acknowledgeConflict,
    );
  });
  app.post('/api/v1/chats/:id/cancel', async (request) => {
    const id = idParams.parse(request.params).id;
    await chatRuntime(id).cancel(id);
    return { ok: true };
  });
  app.post('/api/v1/chats/:id/resume', async (request) => {
    const id = idParams.parse(request.params).id;
    if (store.chat(id).backend === 'acp') return acp.resume();
    return runtime.resume(id);
  });
  app.get('/api/v1/chats/:id/events', async (request, reply) => {
    const { id } = idParams.parse(request.params),
      { cursor } = z
        .object({ cursor: z.coerce.number().int().nonnegative().default(0) })
        .parse(request.query);
    const source = await chatRuntime(id).stream(id, cursor);
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
    const form = vercelCredentials
      .partial({ token: true })
      .extend({ token: z.string().trim().max(8192).optional() })
      .parse(request.body);
    const saved = await vault.get<{ token: string }>('sandbox:vercel');
    const token = form.token || saved?.token;
    if (!token)
      throw new AppError(
        400,
        'sandbox_missing',
        'Enter a Vercel access token for the first connection.',
      );
    const input = vercelCredentials.parse({ ...form, token });
    await saveSandboxConnection('vercel', input);
    return { ok: true };
  });
  app.get('/api/v1/sandbox/vercel/connection', async () => {
    const saved = await vault.get<{ token: string; teamId: string; projectId: string }>(
      'sandbox:vercel',
    );
    return saved
      ? { teamId: saved.teamId, projectId: saved.projectId, hasToken: true }
      : { teamId: '', projectId: '', hasToken: false };
  });
  for (const [provider, proof] of Object.entries(additionalClouds)) {
    app.post(`/api/v1/sandbox/${provider}`, async (request) => {
      await saveSandboxConnection(provider, cloudKeyCredentials.parse(request.body));
      return { ok: true };
    });
    app.post(`/api/v1/sandbox/${provider}/proof`, async (request) => {
      z.object({ acknowledgeUsage: z.literal(true) })
        .strict()
        .parse(request.body);
      return proof.run();
    });
    app.post(`/api/v1/sandbox/${provider}/receipts/:id/reconcile`, async (request) => {
      z.object({}).strict().parse(request.body);
      return proof.reconcile(idParams.parse(request.params).id);
    });
  }
  app.get('/api/v1/sandbox/space', async () => space.state());
  app.post('/api/v1/sandbox/space', async (request) => space.save(request.body));
  app.post('/api/v1/sandbox/space/check', async () => space.check());
  app.post('/api/v1/sandbox/space/proof', async (request, reply) => {
    z.object({ acknowledgeUsage: z.literal(true), acknowledgeCleanup: z.literal(true) }).parse(
      request.body,
    );
    return reply.code(202).send(await space.start());
  });
  app.post('/api/v1/sandbox/space/receipts/:id/reconcile', async (request, reply) =>
    reply.code(202).send(await space.reconcile(idParams.parse(request.params).id)),
  );
  app.post('/api/v1/sandbox/space/receipts/:id/review-absence', async (request, reply) => {
    const { resolution } = z
      .object({
        acknowledgeProviderReview: z.literal(true),
        resolution: z.string().trim().min(20).max(2000),
      })
      .parse(request.body);
    return reply
      .code(202)
      .send(await space.reconcile(idParams.parse(request.params).id, resolution));
  });
  app.get('/api/v1/sandbox/docker', async () => runtime.docker.availability());
  app.post('/api/v1/sandbox/docker/proof', async (request) => {
    z.object({}).strict().parse(request.body);
    return runtime.docker.proof();
  });
  app.post('/api/v1/sandbox/docker/receipts/:id/reconcile', async (request) => {
    z.object({}).strict().parse(request.body);
    return runtime.docker.reconcile(idParams.parse(request.params).id);
  });
  app.post('/api/v1/sandbox/modal', async (request) => {
    await saveSandboxConnection('modal', modalCredentials.parse(request.body));
    return { ok: true };
  });
  app.post('/api/v1/sandbox/modal/proof', async (request) => {
    z.object({ acknowledgeUsage: z.literal(true) })
      .strict()
      .parse(request.body);
    return modal.run();
  });
  app.post('/api/v1/sandbox/modal/receipts/:id/reconcile', async (request) => {
    z.object({}).strict().parse(request.body);
    return modal.reconcile(idParams.parse(request.params).id);
  });
  app.post('/api/v1/sandbox/vercel/receipts/:id/reconcile', async (request) => {
    z.object({}).strict().parse(request.body);
    return sandbox.reconcile(idParams.parse(request.params).id);
  });
  app.post('/api/v1/sandbox/vercel/receipts/:id/review-absence', async (request) => {
    const { resolution } = z
      .object({
        acknowledgeProviderReview: z.literal(true),
        resolution: z.string().trim().min(20).max(2000),
      })
      .strict()
      .parse(request.body);
    return sandbox.reviewAbsence(idParams.parse(request.params).id, resolution);
  });
  app.post('/api/v1/sandbox/vercel/proof', async (request) => {
    z.object({ acknowledgeUsage: z.literal(true) })
      .strict()
      .parse(request.body);
    return sandbox.run();
  });
  app.post('/api/v1/agents', async (request) => acp.add(request.body));
  app.post('/api/v1/agents/:id/check', async (request) => {
    z.object({}).strict().parse(request.body);
    return acp.check(idParams.parse(request.params).id);
  });
  app.post('/api/v1/agents/:id/disabled', async (request) => {
    const { disabled } = z.object({ disabled: z.boolean() }).strict().parse(request.body);
    await acp.disable(idParams.parse(request.params).id, disabled);
    return { ok: true };
  });
  app.post('/api/v1/agent-permissions/:id', async (request) => {
    const { optionId } = z
      .object({ optionId: z.string().max(2000) })
      .strict()
      .parse(request.body);
    acp.decide(idParams.parse(request.params).id, optionId);
    return { ok: true };
  });
  app.post('/api/v1/agent-turns/:id/review', async (request) => {
    const { resolution } = z
      .object({
        acknowledgeExternalReview: z.literal(true),
        resolution: z.string().trim().min(20).max(2000),
      })
      .strict()
      .parse(request.body);
    acp.review(idParams.parse(request.params).id, resolution);
    return { ok: true };
  });
  extensionRoutes(app, store, runtime.extensions);
  if (options.staticDir && existsSync(options.staticDir)) {
    await app.register(serveStatic, { root: resolve(options.staticDir), index: ['index.html'] });
  }
  app.addHook('preClose', async () => {
    await space.close();
    await Promise.allSettled([...readers].map((reader) => reader.cancel()));
  });
  app.addHook('onClose', async () => {
    await acp.close();
    await runtime.close();
    store.close();
  });
  return { app, store, vault, runtime, acp, space };
}
