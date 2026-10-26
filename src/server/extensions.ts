import type { FastifyInstance } from 'fastify';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
import type { Extensions } from '../extensions/runtime.js';
import { AppError } from '../domain.js';
import { readWorkspaceFile } from '../tools/files.js';
const projectParams = z.object({ projectId: z.string().uuid() }),
  itemParams = projectParams.extend({ id: z.string().uuid() });
export function extensionRoutes(app: FastifyInstance, store: Store, ext: Extensions) {
  app.get('/api/v1/projects/:projectId/extensions', async (req) => {
    const { projectId } = projectParams.parse(req.params);
    return {
      skills: ext.skills.list(projectId),
      servers: ext.mcp.list(projectId),
      calls: ext.mcp.calls(projectId),
      memoryPolicy: ext.memory.policy(projectId),
    };
  });
  app.post('/api/v1/projects/:projectId/skills', async (req) =>
    ext.skills.import(projectParams.parse(req.params).projectId, req.body),
  );
  app.post('/api/v1/projects/:projectId/skills/preview', async (req) => {
    const { projectId } = projectParams.parse(req.params),
      { path } = z
        .object({ path: z.string().max(2048) })
        .strict()
        .parse(req.body);
    return {
      markdown: await readWorkspaceFile(store.project(projectId).root, path),
      source: `Project file: ${path}`,
    };
  });
  app.post('/api/v1/projects/:projectId/skills/:id', async (req) => {
    const { projectId, id } = itemParams.parse(req.params),
      { action } = z
        .object({ action: z.enum(['enable', 'disable', 'rollback', 'delete']) })
        .strict()
        .parse(req.body);
    return ext.skills.change(projectId, id, action) ?? { ok: true };
  });
  app.post('/api/v1/projects/:projectId/mcp', async (req) =>
    ext.mcp.add(projectParams.parse(req.params).projectId, req.body),
  );
  app.post('/api/v1/projects/:projectId/mcp/:id/discover', async (req) => {
    z.object({}).strict().parse(req.body);
    const { projectId, id } = itemParams.parse(req.params);
    return ext.mcp.discover(projectId, id);
  });
  app.post('/api/v1/projects/:projectId/mcp/:id/configure', async (req) => {
    const { projectId, id } = itemParams.parse(req.params),
      { enabled, allowed } = z
        .object({ enabled: z.boolean(), allowed: z.array(z.string().max(100)).max(64) })
        .strict()
        .parse(req.body);
    ext.mcp.configure(projectId, id, enabled, allowed);
    return { ok: true };
  });
  app.post('/api/v1/projects/:projectId/mcp/:id/delete', async (req) => {
    z.object({}).strict().parse(req.body);
    const { projectId, id } = itemParams.parse(req.params);
    await ext.mcp.remove(projectId, id);
    return { ok: true };
  });
  app.post('/api/v1/projects/:projectId/mcp-calls', async (req) => {
    const { serverId, tool, args, operationId } = z
      .object({
        serverId: z.string().uuid(),
        tool: z.string().max(100),
        args: z.record(z.string(), z.unknown()),
        operationId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    return ext.mcp.stage(
      projectParams.parse(req.params).projectId,
      serverId,
      tool,
      args,
      `user:${operationId}`,
    );
  });
  app.post('/api/v1/projects/:projectId/mcp-calls/:id', async (req) => {
    const { projectId, id } = itemParams.parse(req.params),
      body = z
        .discriminatedUnion('action', [
          z.object({ action: z.literal('approve'), digest: z.string().length(64) }).strict(),
          z.object({ action: z.literal('reject') }).strict(),
          z
            .object({
              action: z.literal('resolve'),
              resolution: z.string().trim().min(10).max(2000),
            })
            .strict(),
        ])
        .parse(req.body);
    if (body.action === 'approve') return ext.mcp.approve(projectId, id, body.digest);
    ext.mcp.resolve(projectId, id, body.action, body.action === 'resolve' ? body.resolution : '');
    return { ok: true };
  });
  app.get('/api/v1/hub', async () => ext.hub.catalog());
  app.post('/api/v1/hub/refresh', async (req) => {
    z.object({}).strict().parse(req.body);
    return ext.hub.refresh();
  });
  app.post('/api/v1/hub/assess', async (req) =>
    ext.hub.assess(
      z
        .object({ id: z.string().max(100) })
        .strict()
        .parse(req.body).id,
    ),
  );
  app.post('/api/v1/hub/skill', async (req) => {
    const { id, path } = z
      .object({ id: z.string().max(100), path: z.string().max(1000) })
      .strict()
      .parse(req.body);
    return ext.hub.skill(id, path);
  });
  app.get('/api/v1/projects/:projectId/memory', async (req) => {
    const { projectId } = projectParams.parse(req.params);
    const { query, area } = z
      .object({
        query: z.string().max(2000).default(''),
        area: z.enum(['', 'main', 'fragments', 'solutions']).default(''),
      })
      .parse(req.query);
    return {
      notes: ext.memory.search(projectId, query, area, 100),
      total: ext.memory.list(projectId).length,
      policy: ext.memory.policy(projectId),
      index: ext.embeddings.state(projectId),
    };
  });
  app.post('/api/v1/projects/:projectId/memory/search', async (req) => {
    const { query, area, semantic } = z
      .object({
        query: z.string().max(2000),
        area: z.enum(['', 'main', 'fragments', 'solutions']).default(''),
        semantic: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    return ext.embeddings.search(projectParams.parse(req.params).projectId, query, area, semantic);
  });
  app.post('/api/v1/projects/:projectId/memory', async (req) => {
    const { note, operationId, id } = z
      .object({
        note: z.unknown(),
        operationId: z.string().uuid(),
        id: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    return ext.memory.save(
      projectParams.parse(req.params).projectId,
      note,
      `user:${operationId}`,
      id,
    );
  });
  app.post('/api/v1/projects/:projectId/memory/:id/delete', async (req) => {
    const { projectId, id } = itemParams.parse(req.params),
      { operationId } = z.object({ operationId: z.string().uuid() }).strict().parse(req.body);
    return ext.memory.delete(projectId, id, `user:${operationId}`);
  });
  app.post('/api/v1/projects/:projectId/memory/policy', async (req) => {
    ext.memory.setPolicy(
      projectParams.parse(req.params).projectId,
      z.object({ read: z.boolean(), write: z.boolean() }).strict().parse(req.body),
    );
    return { ok: true };
  });
  app.get('/api/v1/projects/:projectId/memory/export', async (req) =>
    ext.memory.export(projectParams.parse(req.params).projectId),
  );
  app.post('/api/v1/projects/:projectId/memory/import', async (req) => {
    const { document, operationId } = z
      .object({ document: z.unknown(), operationId: z.string().uuid() })
      .strict()
      .parse(req.body);
    return ext.memory.import(
      projectParams.parse(req.params).projectId,
      document,
      `import:${operationId}`,
    );
  });
  app.get('/api/v1/embeddings', async () => ({
    connections: ext.embeddings.connections(),
    local: await ext.embeddings.local.status(),
  }));
  app.post('/api/v1/embeddings', async (req) => ext.embeddings.add(req.body));
  app.post('/api/v1/embeddings/:id/delete', async (req) => {
    z.object({}).strict().parse(req.body);
    await ext.embeddings.removeConnection(z.object({ id: z.string().uuid() }).parse(req.params).id);
    return { ok: true };
  });
  app.post('/api/v1/embeddings/runtime', async (req) => {
    const { action, acknowledgeDownload } = z
      .object({
        action: z.enum(['install', 'cancel', 'remove']),
        acknowledgeDownload: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (action === 'install') {
      if (acknowledgeDownload !== true)
        throw new AppError(
          400,
          'runtime_consent',
          'Confirm the optional runtime download before installing it.',
        );
      await ext.embeddings.local.installRuntime();
    } else if (action === 'cancel') await ext.embeddings.local.addon.cancel();
    else await ext.embeddings.removeRuntime();
    return ext.embeddings.local.status();
  });
  app.post('/api/v1/embeddings/local', async (req) => {
    const { action } = z
      .object({ action: z.enum(['download', 'pause', 'delete']) })
      .strict()
      .parse(req.body);
    if (action === 'download') await ext.embeddings.local.start();
    else if (action === 'pause') await ext.embeddings.local.cancel();
    else await ext.embeddings.removeLocal();
    return ext.embeddings.local.status();
  });
  app.post('/api/v1/projects/:projectId/memory/index', async (req) => {
    const { projectId } = projectParams.parse(req.params),
      body = z
        .discriminatedUnion('action', [
          z
            .object({
              action: z.literal('build'),
              connectionId: z.string().max(80),
              acknowledgeSharing: z.boolean(),
            })
            .strict(),
          z.object({ action: z.enum(['pause', 'lexical']) }).strict(),
        ])
        .parse(req.body);
    if (body.action === 'build')
      return ext.embeddings.start(projectId, body.connectionId, body.acknowledgeSharing);
    if (body.action === 'pause') await ext.embeddings.cancel(projectId);
    else await ext.embeddings.lexicalOnly(projectId);
    return ext.embeddings.state(projectId);
  });
  app.get('/api/v1/memory/backups', async () => {
    const dir = join(store.dir, 'backups');
    const names = await readdir(dir).catch(() => []);
    return Promise.all(
      names
        .filter((n) => /^schema-[123]-\d+-[a-f0-9-]+\.db$/.test(n))
        .map(async (name) => ({ name, bytes: (await stat(join(dir, name))).size })),
    );
  });
  app.post('/api/v1/memory/backups/delete', async (req) => {
    const { name, acknowledge } = z
      .object({
        name: z.string().regex(/^schema-[123]-\d+-[a-f0-9-]+\.db$/),
        acknowledge: z.literal(true),
      })
      .strict()
      .parse(req.body);
    await unlink(join(store.dir, 'backups', name));
    return { ok: true };
  });
}
