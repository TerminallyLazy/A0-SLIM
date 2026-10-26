import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Operation } from '../policy/operations.js';
import type { Chat, Connection, Project } from '../domain.js';
import { AppError } from '../domain.js';

export class Store {
  readonly db: Database.Database;
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    this.db = new Database(join(dir, 'a0-slim.db'));
    chmodSync(join(dir, 'a0-slim.db'), 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    const version = this.meta('schema_version');
    if (version && !['1', '2', '3'].includes(version))
      throw new Error(
        'Unsupported database schema. Back up the data before changing application versions.',
      );
    if (version && version !== '3') {
      const backups = join(dir, 'backups');
      mkdirSync(backups, { recursive: true, mode: 0o700 });
      const backup = join(backups, `schema-${version}-${Date.now()}-${randomUUID()}.db`);
      this.db.prepare('VACUUM INTO ?').run(backup);
      chmodSync(backup, 0o600);
    }
    this.db.transaction(() => {
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      );
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS feature_records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, project TEXT NOT NULL, area TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, digest TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, project UNINDEXED, text);
        CREATE TABLE IF NOT EXISTS memory_vectors (namespace TEXT NOT NULL, id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE, digest TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(namespace,id));
        CREATE TABLE IF NOT EXISTS memory_ops (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
      `);
      this.setMeta('schema_version', '3');
    })();
    this.db.pragma('synchronous = FULL');
    for (const operation of this.operations())
      if (operation.status === 'running') this.saveOperation({ ...operation, status: 'unknown' });
    if (!this.meta('host_id')) this.setMeta('host_id', `urn:uuid:${randomUUID()}`);
    for (const chat of this.chats())
      if (chat.status === 'running') this.saveChat({ ...chat, status: 'interrupted' });
  }
  meta(key: string) {
    return (
      this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as
        { value: string } | undefined
    )?.value;
  }
  records<T>(kind: string): T[] {
    return (
      this.db
        .prepare('SELECT data FROM feature_records WHERE kind=? ORDER BY rowid DESC')
        .all(kind) as { data: string }[]
    ).map((row) => JSON.parse(row.data) as T);
  }
  record<T extends { id: string }>(kind: string, value: T) {
    this.db
      .prepare(
        'INSERT INTO feature_records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(kind, value.id, JSON.stringify(value));
  }
  removeRecord(kind: string, id: string) {
    this.db.prepare('DELETE FROM feature_records WHERE kind=? AND id=?').run(kind, id);
  }
  setMeta(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(key, value);
  }
  private list<T>(table: 'connections' | 'projects' | 'chats' | 'receipts' | 'operations'): T[] {
    return (
      this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all() as { data: string }[]
    ).map((row) => JSON.parse(row.data) as T);
  }
  private save(
    table: 'connections' | 'projects' | 'chats' | 'receipts' | 'operations',
    value: { id: string },
  ) {
    this.db
      .prepare(`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
      .run(value.id, JSON.stringify(value));
  }
  connections() {
    return this.list<Connection>('connections');
  }
  connection(id: string) {
    const c = this.connections().find((c) => c.id === id);
    if (!c) throw new AppError(404, 'connection_missing', 'Choose a model connection first.');
    return c;
  }
  saveConnection(value: Connection) {
    this.save('connections', value);
  }
  projects() {
    return this.list<Project>('projects');
  }
  project(id: string) {
    const p = this.projects().find((p) => p.id === id);
    if (!p) throw new AppError(404, 'project_missing', 'Project not found.');
    return p;
  }
  saveProject(value: Project) {
    this.save('projects', value);
  }
  chats() {
    return this.list<Chat>('chats');
  }
  chat(id: string) {
    const c = this.chats().find((c) => c.id === id);
    if (!c) throw new AppError(404, 'chat_missing', 'Chat not found.');
    return c;
  }
  saveChat(value: Chat) {
    this.save('chats', value);
  }
  receipt(value: { id: string; [key: string]: unknown }) {
    this.save('receipts', value);
  }
  receipts() {
    return this.list<Record<string, unknown>>('receipts');
  }
  operations() {
    return this.list<Operation>('operations');
  }
  operation(id: string) {
    const operation = this.operations().find((o) => o.id === id);
    if (!operation) throw new AppError(404, 'operation_missing', 'Artifact not found.');
    return operation;
  }
  saveOperation(operation: Operation) {
    this.save('operations', operation);
  }
  close() {
    this.db.close();
  }
}
