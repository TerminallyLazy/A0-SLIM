import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, safeEndpoint } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { digest } from '../extensions/skills.js';
import { MemoryStore, type MemoryNote } from './store.js';
import { LocalModel, localModelManifest } from './local-model.js';
export type EmbeddingConnection = {
  id: string;
  name: string;
  kind: 'local' | 'compatible';
  model: string;
  revision: string;
  dimension: number;
  baseUrl?: string;
  hasCredential: boolean;
};
export type IndexJob = {
  id: string;
  projectId: string;
  connectionId: string;
  namespace: string;
  status: 'building' | 'ready' | 'paused' | 'failed';
  done: number;
  total: number;
  error?: string;
};
export const embeddingInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().max(500),
    model: z.string().trim().min(1).max(200),
    revision: z.string().trim().min(1).max(100),
    dimension: z.number().int().min(1).max(4096),
    apiKey: z.string().max(8192).optional(),
  })
  .strict();
export function normalize(vector: unknown, dimension: number) {
  if (
    !Array.isArray(vector) ||
    vector.length !== dimension ||
    vector.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  )
    throw new AppError(
      502,
      'embedding_shape',
      'Embedding output has the wrong dimension or non-finite values.',
    );
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm <= 0)
    throw new AppError(502, 'embedding_shape', 'Embedding output has zero length.');
  return vector.map((n) => n / norm);
}
const local: EmbeddingConnection = {
  id: 'local-minilm',
  name: 'Local MiniLM · Hugging Face',
  kind: 'local',
  model: localModelManifest.id,
  revision: localModelManifest.revision,
  dimension: 384,
  hasCredential: false,
};
export class Embeddings {
  readonly local: LocalModel;
  private jobs = new Map<string, { abort: AbortController; done: Promise<void> }>();
  constructor(
    private store: Store,
    private vault: Vault,
    private memory: MemoryStore,
  ) {
    this.local = new LocalModel(store.dir);
    for (const j of this.store.records<IndexJob>('index'))
      if (j.status === 'building') this.store.record('index', { ...j, status: 'paused' });
  }
  connections() {
    return [local, ...this.store.records<EmbeddingConnection>('embedding')];
  }
  connection(id: string) {
    const c = this.connections().find((c) => c.id === id);
    if (!c) throw new AppError(404, 'embedding_missing', 'Embedding connection not found.');
    return c;
  }
  async add(raw: unknown) {
    const { apiKey, ...input } = embeddingInput.parse(raw);
    const connection: EmbeddingConnection = {
      ...input,
      id: randomUUID(),
      kind: 'compatible',
      baseUrl: safeEndpoint(input.baseUrl),
      hasCredential: !!apiKey,
    };
    if (apiKey) await this.vault.set(`embedding:${connection.id}`, { apiKey });
    this.store.record('embedding', connection);
    return connection;
  }
  namespace(c: EmbeddingConnection) {
    return digest({
      provider: c.id,
      model: c.model,
      revision: c.revision,
      dimension: c.dimension,
      normalization: 'l2',
      preprocessing: 'utf8-trim-v1',
      pooling: c.kind === 'local' ? 'mean-q8' : 'provider',
    });
  }
  async embed(c: EmbeddingConnection, text: string, signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (c.kind === 'local') return normalize(await this.local.infer(text.trim()), c.dimension);
    const key = await this.vault.get<{ apiKey: string }>(`embedding:${c.id}`);
    const response = await fetch(`${c.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key?.apiKey ? { authorization: `Bearer ${key.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: c.model, input: text.trim(), encoding_format: 'float' }),
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || !response.body)
      throw new AppError(502, 'embedding_failed', 'The embedding service rejected this request.');
    let body = '',
      bytes = 0;
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 256000) throw new Error('Embedding response too large');
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    return normalize(JSON.parse(body).data?.[0]?.embedding, c.dimension);
  }
  state(projectId: string) {
    return {
      active: this.store.meta(`embedding-active:${projectId}`) ?? null,
      jobs: this.store.records<IndexJob>('index').filter((j) => j.projectId === projectId),
      sharing: this.store.meta(`embedding-sharing:${projectId}`) ?? null,
    };
  }
  start(projectId: string, connectionId: string, acknowledgeSharing: boolean) {
    this.store.project(projectId);
    const c = this.connection(connectionId);
    if (c.kind === 'compatible' && !acknowledgeSharing)
      throw new AppError(
        403,
        'embedding_sharing',
        'Confirm that project memory and search queries may be sent to this embedding connection.',
      );
    if (this.jobs.has(projectId))
      throw new AppError(409, 'index_busy', 'An index is already building for this project.');
    const namespace = this.namespace(c),
      notes = this.memory.list(projectId),
      abort = new AbortController();
    const job: IndexJob = {
      id: `${projectId}:${namespace}`,
      projectId,
      connectionId,
      namespace,
      status: 'building',
      done: 0,
      total: notes.length,
    };
    this.store.record('index', job);
    const done = Promise.resolve().then(async () => {
      try {
        for (const note of notes) {
          if (abort.signal.aborted) throw new Error('Paused');
          const cached = this.store.db
            .prepare('SELECT digest FROM memory_vectors WHERE namespace=? AND id=?')
            .get(namespace, note.id) as { digest: string } | undefined;
          if (cached?.digest !== note.digest) {
            const vector = await this.embed(c, note.text, abort.signal);
            const current = this.memory.list(projectId).find((n) => n.id === note.id);
            if (current?.digest !== note.digest) throw new Error('Memory changed');
            this.store.db
              .prepare('INSERT OR REPLACE INTO memory_vectors VALUES (?,?,?,?)')
              .run(namespace, note.id, note.digest, JSON.stringify(vector));
          }
          job.done++;
          this.store.record('index', job);
        }
        if (
          abort.signal.aborted ||
          digest(this.memory.list(projectId).map((n) => [n.id, n.digest])) !==
            digest(notes.map((n) => [n.id, n.digest]))
        )
          throw new Error('Memory changed');
        this.store.db.transaction(() => {
          this.store.record('index', { ...job, status: 'ready' });
          this.store.setMeta(`embedding-active:${projectId}`, c.id);
          this.store.setMeta(`embedding-sharing:${projectId}`, c.kind === 'compatible' ? c.id : '');
        })();
      } catch {
        this.store.record('index', {
          ...job,
          status: abort.signal.aborted ? 'paused' : 'failed',
          error: abort.signal.aborted
            ? 'Paused; verified vectors are retained for resume.'
            : 'Index incomplete. Check the model or connection; if memory changed, rebuild to resume. The previous index remains active.',
        });
      } finally {
        this.jobs.delete(projectId);
      }
    });
    this.jobs.set(projectId, { abort, done });
    return job;
  }
  async cancel(projectId: string) {
    const job = this.jobs.get(projectId);
    job?.abort.abort();
    await job?.done;
  }
  async lexicalOnly(projectId: string) {
    await this.cancel(projectId);
    this.store.setMeta(`embedding-active:${projectId}`, '');
    this.store.setMeta(`embedding-sharing:${projectId}`, '');
  }
  async search(projectId: string, query: string, area = '', semantic = true) {
    const lexical = this.memory.search(projectId, query, area, 50),
      active = this.store.meta(`embedding-active:${projectId}`);
    if (!semantic || !active || !query.trim())
      return { notes: lexical.slice(0, 20), mode: 'lexical' };
    const c = this.connection(active);
    if (c.kind === 'compatible' && this.store.meta(`embedding-sharing:${projectId}`) !== c.id)
      return { notes: lexical.slice(0, 20), mode: 'lexical' };
    try {
      const vector = await this.embed(c, query),
        namespace = this.namespace(c),
        notes = this.memory.list(projectId).filter((n) => !area || n.area === area),
        rows = this.store.db
          .prepare(
            `SELECT v.id,v.vector FROM memory_vectors v JOIN memories m ON m.id=v.id WHERE v.namespace=? AND m.project=? AND v.digest=m.digest AND (?='' OR m.area=?)`,
          )
          .all(namespace, projectId, area, area) as { id: string; vector: string }[];
      const scores = rows
          .map((r) => ({
            id: r.id,
            score: normalize(JSON.parse(r.vector), c.dimension).reduce(
              (s, n, i) => s + n * vector[i]!,
              0,
            ),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 50),
        fused = new Map<string, number>();
      lexical.forEach((n, i) => fused.set(n.id, 1 / (60 + i + 1)));
      scores.forEach((n, i) => fused.set(n.id, (fused.get(n.id) ?? 0) + 1 / (60 + i + 1)));
      return {
        notes: notes
          .filter((n) => fused.has(n.id))
          .map((n) => ({ ...n, score: fused.get(n.id)! }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 20),
        mode: 'hybrid',
      };
    } catch {
      return { notes: lexical.slice(0, 20), mode: 'lexical · semantic search unavailable' };
    }
  }
  async removeConnection(id: string) {
    if (id === 'local-minilm')
      throw new AppError(
        400,
        'local_connection',
        'Use Remove local model to delete downloaded weights.',
      );
    for (const p of this.store.projects())
      if (this.state(p.id).active === id || this.jobs.has(p.id))
        throw new AppError(
          409,
          'embedding_used',
          'Switch affected projects to lexical search and stop indexing before removing this connection.',
        );
    const c = this.connection(id);
    this.store.db.prepare('DELETE FROM memory_vectors WHERE namespace=?').run(this.namespace(c));
    await this.vault.remove(`embedding:${id}`);
    this.store.removeRecord('embedding', id);
  }
  async removeLocal() {
    for (const p of this.store.projects())
      if (this.state(p.id).active === 'local-minilm' || this.jobs.has(p.id))
        throw new AppError(
          409,
          'model_used',
          'Switch projects to lexical search and stop indexing before removing the local model.',
        );
    await this.local.remove();
    this.store.db
      .prepare('DELETE FROM memory_vectors WHERE namespace=?')
      .run(this.namespace(local));
  }
  async close() {
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)));
    await this.local.close();
  }
}
