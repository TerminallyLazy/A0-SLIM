import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import { digest } from '../extensions/skills.js';
export const memoryInput = z
  .object({
    text: z.string().trim().min(1).max(16000),
    area: z.enum(['main', 'fragments', 'solutions']).default('main'),
    source: z.string().trim().min(1).max(500),
  })
  .strict();
export type MemoryNote = {
  id: string;
  project: string;
  text: string;
  area: 'main' | 'fragments' | 'solutions';
  source: string;
  created: string;
  updated: string;
  digest: string;
  score?: number;
};
export type MemoryPolicy = { read: boolean; write: boolean };
export class MemoryStore {
  constructor(readonly store: Store) {}
  policy(project: string): MemoryPolicy {
    this.store.project(project);
    return JSON.parse(
      this.store.meta(`memory-policy:${project}`) ?? '{"read":false,"write":false}',
    );
  }
  setPolicy(project: string, policy: MemoryPolicy) {
    this.store.project(project);
    this.store.setMeta(`memory-policy:${project}`, JSON.stringify(policy));
  }
  assert(project: string, mode: keyof MemoryPolicy) {
    if (!this.policy(project)[mode])
      throw new AppError(403, 'memory_permission', `Project memory ${mode} permission is off.`);
  }
  list(project: string): MemoryNote[] {
    this.store.project(project);
    return this.store.db
      .prepare('SELECT * FROM memories WHERE project=? ORDER BY updated DESC,id')
      .all(project) as MemoryNote[];
  }
  search(project: string, query: string, area = '', limit = 20): MemoryNote[] {
    this.store.project(project);
    const words = (query.match(/[\p{L}\p{N}_]+/gu) ?? [])
      .slice(0, 24)
      .map((w) => `"${w}"`)
      .join(' OR ');
    if (!words)
      return this.list(project)
        .filter((n) => !area || n.area === area)
        .slice(0, limit);
    return this.store.db
      .prepare(
        `SELECT m.*, -bm25(memory_fts) AS score FROM memory_fts JOIN memories m ON m.id=memory_fts.id WHERE memory_fts MATCH ? AND m.project=? AND (?='' OR m.area=?) ORDER BY bm25(memory_fts),m.id LIMIT ?`,
      )
      .all(words, project, area, area, limit) as MemoryNote[];
  }
  private once(key: string, request: unknown, fn: () => { id: string; status: string }) {
    return this.store.db.transaction(() => {
      const hash = digest(request),
        prior = this.store.db
          .prepare('SELECT digest,result FROM memory_ops WHERE id=?')
          .get(key) as { digest: string; result: string } | undefined;
      if (prior) {
        if (prior.digest !== hash)
          throw new AppError(
            409,
            'memory_replay',
            'This operation ID already belongs to a different memory action.',
          );
        return JSON.parse(prior.result) as { id: string; status: string };
      }
      const result = fn();
      this.store.db
        .prepare('INSERT INTO memory_ops VALUES (?,?,?)')
        .run(key, hash, JSON.stringify(result));
      return result;
    })();
  }
  save(project: string, raw: unknown, key: string, id?: string) {
    this.store.project(project);
    const input = memoryInput.parse(raw);
    return this.once(`${project}:${key}`, { project, input, id }, () => {
      const prior = id
        ? (this.store.db
            .prepare('SELECT * FROM memories WHERE project=? AND id=?')
            .get(project, id) as MemoryNote | undefined)
        : undefined;
      if (id && !prior)
        throw new AppError(404, 'memory_missing', 'Memory not found in this project.');
      if (
        !prior &&
        (
          this.store.db
            .prepare('SELECT count(*) AS n FROM memories WHERE project=?')
            .get(project) as { n: number }
        ).n >= 10000
      )
        throw new AppError(400, 'memory_limit', 'This project has reached the 10,000 note limit.');
      const note: MemoryNote = {
        id: prior?.id ?? randomUUID(),
        project,
        ...input,
        created: prior?.created ?? new Date().toISOString(),
        updated: new Date().toISOString(),
        digest: digest(input.text),
      };
      this.store.db
        .prepare(
          'INSERT INTO memories VALUES (@id,@project,@area,@text,@source,@created,@updated,@digest) ON CONFLICT(id) DO UPDATE SET text=excluded.text,area=excluded.area,source=excluded.source,updated=excluded.updated,digest=excluded.digest',
        )
        .run(note);
      this.store.db.prepare('DELETE FROM memory_fts WHERE id=?').run(note.id);
      this.store.db
        .prepare('INSERT INTO memory_fts VALUES (?,?,?)')
        .run(note.id, project, note.text);
      this.store.db.prepare('DELETE FROM memory_vectors WHERE id=?').run(note.id);
      return { id: note.id, status: 'saved' };
    });
  }
  delete(project: string, id: string, key: string) {
    this.store.project(project);
    return this.once(`${project}:${key}`, { project, id, action: 'delete' }, () => {
      if (!this.list(project).some((n) => n.id === id))
        throw new AppError(404, 'memory_missing', 'Memory not found in this project.');
      this.store.db.prepare('DELETE FROM memory_fts WHERE id=?').run(id);
      this.store.db.prepare('DELETE FROM memories WHERE id=? AND project=?').run(id, project);
      return { id, status: 'deleted' };
    });
  }
  export(project: string) {
    return {
      schema: 'a0-slim.memory.v1',
      notes: this.list(project).map(({ text, area, source, created, updated }) => ({
        text,
        area,
        source,
        created,
        updated,
      })),
    };
  }
  import(project: string, raw: unknown, key: string) {
    const data = z
      .object({
        schema: z.literal('a0-slim.memory.v1'),
        notes: z
          .array(
            memoryInput.extend({ created: z.string().optional(), updated: z.string().optional() }),
          )
          .max(1000),
      })
      .strict()
      .parse(raw);
    return this.store.db.transaction(() =>
      data.notes.map(({ text, area, source }, i) =>
        this.save(project, { text, area, source }, `${key}:${i}`),
      ),
    )();
  }
}
