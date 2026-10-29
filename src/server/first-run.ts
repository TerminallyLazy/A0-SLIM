import { mkdir, lstat, realpath, writeFile, readFile, access } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Store } from '../storage/store.js';
import { defaultAccess } from '../policy/access.js';
import { AppError, type Connection } from '../domain.js';

type Preferences = {
  started?: boolean;
  completedAt?: string;
  projectId?: string;
  connectionId?: string;
};
export type FirstRunState = Preferences & { required: boolean; workspacePath: string };
export const usableConnection = (c: Connection) =>
  !!c.model && (c.kind === 'compatible' || c.hasCredential);
const fail = (message: string) => new AppError(409, 'setup_incomplete', message);
const contains = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

export class FirstRun {
  private creating?: Promise<ReturnType<Store['project']>>;
  constructor(
    private store: Store,
    private workspacePath: string,
  ) {}
  private preferences(): Preferences {
    return JSON.parse(this.store.meta('first-run') ?? '{}');
  }
  state(): FirstRunState {
    const saved = this.preferences();
    return {
      ...saved,
      workspacePath: this.workspacePath,
      required:
        !saved.completedAt &&
        (!!saved.started ||
          (!this.store.chats().length &&
            (!this.store.projects().length || !this.store.connections().some(usableConnection)))),
    };
  }
  save(patch: Pick<Preferences, 'projectId' | 'connectionId'> = {}) {
    if (patch.projectId) this.store.project(patch.projectId);
    if (patch.connectionId && !usableConnection(this.store.connection(patch.connectionId)))
      throw fail('Choose a model for a connected account first.');
    const next = { ...this.preferences(), ...patch, started: true };
    this.store.setMeta('first-run', JSON.stringify(next));
    return this.state();
  }
  async workspace() {
    if (this.creating) return this.creating;
    this.creating = this.createWorkspace();
    try {
      return await this.creating;
    } finally {
      this.creating = undefined;
    }
  }
  private async createWorkspace() {
    const root = this.workspacePath;
    const parent = await realpath(join(root, '..')),
      data = await realpath(this.store.dir);
    const resolved = join(parent, root.split(sep).at(-1)!);
    if (contains(data, resolved) || contains(resolved, data))
      throw fail(
        'The starter workspace must be separate from private application data. Choose an existing project folder instead.',
      );
    const marker = join(root, '.slim-workspace.json');
    const reservationKey = 'first-run-workspace';
    let reservation = JSON.parse(this.store.meta(reservationKey) ?? 'null') as {
      id: string;
      root: string;
      nonce: string;
    } | null;
    if (reservation && reservation.root !== root)
      throw fail('The reserved workspace path changed. Choose a folder explicitly.');
    if (!reservation) {
      try {
        await lstat(root);
        throw fail(
          'That workspace folder already exists. Choose it explicitly under “Use an existing folder”, or select another folder.',
        );
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }
      reservation = { id: randomUUID(), root, nonce: randomUUID() };
      this.store.setMeta(reservationKey, JSON.stringify(reservation));
    }
    let created = false;
    try {
      await mkdir(root, { mode: 0o700 });
      created = true;
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw fail(
        'The starter workspace path is not an owned directory. Choose a folder explicitly.',
      );
    const expected = JSON.stringify({ host: this.store.meta('host_id'), nonce: reservation.nonce });
    // Write once. A pre-existing or changed marker never authorizes an unrelated folder.
    if (created) await writeFile(marker, expected, { flag: 'wx', mode: 0o600 });
    try {
      await lstat(marker);
    } catch {
      throw fail(
        'Workspace creation was interrupted before ownership was recorded. Choose the folder explicitly instead of recreating it.',
      );
    }
    if ((await lstat(marker)).isSymbolicLink() || (await readFile(marker, 'utf8')) !== expected)
      throw fail('Workspace ownership could not be verified. Choose a folder explicitly.');
    const canonical = await realpath(root);
    if (canonical !== resolved) throw fail('The workspace path changed during setup.');
    const project = {
      id: reservation.id,
      name: 'My workspace',
      root: canonical,
      execution: 'none' as const,
      access: defaultAccess(),
    };
    const existing = this.store.projects().find((p) => p.id === project.id);
    if (!existing) this.store.saveProject(project);
    this.save({ projectId: project.id });
    return existing ?? project;
  }
  async complete() {
    const prefs = this.preferences();
    if (!prefs.projectId || !prefs.connectionId)
      throw fail('Choose a workspace and model before starting.');
    const project = this.store.project(prefs.projectId),
      connection = this.store.connection(prefs.connectionId);
    if (!usableConnection(connection)) throw fail('Reconnect your account and choose a model.');
    await access(project.root);
    this.store.setMeta(
      'first-run',
      JSON.stringify({ ...prefs, completedAt: new Date().toISOString() }),
    );
    return this.state();
  }
}
