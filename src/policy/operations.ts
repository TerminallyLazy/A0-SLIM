import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { z } from 'zod';
import type { FxAgentHostTool } from 'libfx';
import type { Store } from '../storage/store.js';
import { accessPath, readAccessFile } from '../tools/access-files.js';
import type { Access } from './access.js';
import { AppError } from '../domain.js';
import { readWorkspaceFile, workspacePath } from '../tools/files.js';

export type Operation = {
  id: string;
  projectId: string;
  chatId: string;
  sessionId: string;
  messageId: string;
  callId: string;
  path: string;
  before: string | null;
  content: string;
  digest: string;
  policy: 'review-v1' | 'access-v1';
  createdAt: string;
  status: 'pending' | 'running' | 'unknown' | 'applied' | 'rejected' | 'conflict';
  approvedAt?: string;
  resolvedAt?: string;
};
const hash = (input: string) => createHash('sha256').update(input).digest('hex');
const inputSchema = z
  .object({ path: z.string().min(1).max(2048), content: z.string().max(256 * 1024) })
  .strict();
const actionDigest = (o: Omit<Operation, 'digest' | 'id' | 'createdAt' | 'status'>) =>
  hash(
    JSON.stringify({
      projectId: o.projectId,
      chatId: o.chatId,
      sessionId: o.sessionId,
      messageId: o.messageId,
      callId: o.callId,
      path: o.path,
      before: o.before,
      content: o.content,
      policy: o.policy,
    }),
  );

/** Host-owned file ledger. Application requires a mode decision or exact paired-UI approval. */
export class Operations {
  private locks = new Set<string>();
  private fileLocks = new Set<string>();
  constructor(
    private store: Store,
    private afterWrite?: () => Promise<void>,
  ) {}
  assertClear(projectId: string) {
    if (
      this.store
        .operations()
        .some(
          (o) => o.projectId === projectId && ['running', 'unknown', 'conflict'].includes(o.status),
        )
    )
      throw new AppError(
        409,
        'effect_unknown',
        'Review and reconcile the unresolved file change before making another change in this project.',
      );
  }
  private async locked<T>(projectId: string, task: () => Promise<T>) {
    if (this.locks.has(projectId))
      throw new AppError(
        409,
        'project_busy',
        'A file change is already being checked in this project.',
      );
    this.locks.add(projectId);
    try {
      return await task();
    } finally {
      this.locks.delete(projectId);
    }
  }
  private async target(root: string, path: string, wide = false) {
    if (wide) return accessPath(root, path, true);
    // Validate the leaf name as well as its existing parent, including denied hidden paths.
    const parent = await workspacePath(root, dirname(path));
    const name = basename(path);
    if (
      !name ||
      ['.', '..', '.env', '.git', '.ssh', '.aws', '.a0-slim', 'node_modules'].includes(name) ||
      name.startsWith('.env.') ||
      name.startsWith('.a0-slim-') ||
      path.includes('\0')
    )
      throw new AppError(403, 'path_denied', 'Choose an ordinary project text file.');
    const target = join(parent.target, name);
    const normalized = relative(parent.base, target);
    try {
      await workspacePath(root, normalized);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return { target, path: normalized, parent: parent.target };
  }
  private async current(root: string, path: string, wide = false) {
    try {
      return wide
        ? await readAccessFile((await accessPath(root, path)).target)
        : await readWorkspaceFile(root, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async readCurrent(id: string) {
    const operation = this.store.operation(id);
    const root = this.store.project(operation.projectId).root;
    const wide = operation.policy === 'access-v1';
    const destination = await this.target(root, operation.path, wide);
    if (wide && destination.path !== operation.path)
      throw new AppError(
        409,
        'path_changed',
        'The recorded path changed. Restore it before review.',
      );
    return this.current(root, operation.path, wide);
  }
  async propose(
    projectId: string,
    sessionId: string,
    callId: string,
    messageId: string,
    input: unknown,
  ) {
    const parsed = inputSchema.parse(input);
    if (Buffer.byteLength(parsed.content) > 256 * 1024 || parsed.content.includes('\0'))
      throw new AppError(413, 'artifact_size', 'Create a text artifact smaller than 256 KiB.');
    return this.locked(projectId, async () => {
      this.assertClear(projectId);
      const chat = this.store
        .chats()
        .find((c) => c.sessionId === sessionId && c.projectId === projectId);
      if (!chat || !messageId)
        throw new AppError(409, 'scope_missing', 'The artifact has no owning chat turn.');
      const root = this.store.project(projectId).root;
      const wide = chat.accessVersion === 1;
      const destination = await this.target(root, parsed.path, wide);
      const existing = this.store
        .operations()
        .find((o) => o.sessionId === sessionId && o.messageId === messageId && o.callId === callId);
      if (existing) {
        if (existing.path !== destination.path || existing.content !== parsed.content)
          throw new AppError(409, 'action_changed', 'A repeated tool call changed its artifact.');
        return existing;
      }
      const before = await this.current(root, destination.path, wide);
      const action = {
        projectId,
        chatId: chat.id,
        sessionId,
        messageId,
        callId,
        path: destination.path,
        before,
        content: parsed.content,
        policy: wide ? ('access-v1' as const) : ('review-v1' as const),
      };
      const operation: Operation = {
        ...action,
        id: randomUUID(),
        digest: actionDigest(action),
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      this.store.saveOperation(operation);
      return operation;
    });
  }
  async apply(id: string, digest: string, authorize?: () => void) {
    const initial = this.store.operation(id);
    return this.locked(initial.projectId, async () => {
      const operation = this.store.operation(id);
      if (operation.digest !== digest || actionDigest(operation) !== digest)
        throw new AppError(
          409,
          'approval_changed',
          'The reviewed artifact no longer matches this approval.',
        );
      if (operation.status === 'applied') return operation;
      this.assertClear(operation.projectId);
      if (operation.status !== 'pending')
        throw new AppError(409, 'approval_required', 'This artifact is not waiting for approval.');
      const root = this.store.project(operation.projectId).root;
      const destination = await this.target(root, operation.path, operation.policy === 'access-v1');
      if (operation.policy === 'access-v1' && destination.path !== operation.path)
        throw new AppError(409, 'path_changed', 'The approved path changed.');
      if (this.fileLocks.has(destination.target))
        throw new AppError(
          409,
          'file_busy',
          'Another project is applying this file. Try again when it finishes.',
        );
      this.fileLocks.add(destination.target);
      try {
        if (
          (await this.current(root, operation.path, operation.policy === 'access-v1')) !==
          operation.before
        )
          throw new AppError(
            409,
            'file_changed',
            'The destination changed after this preview. Reject this artifact and generate a fresh proposal.',
          );
        const parentIdentity = await lstat(destination.parent);
        const temp = join(destination.parent, `.a0-slim-${operation.id}.tmp`);
        const running: Operation = {
          ...operation,
          status: 'running',
          approvedAt: new Date().toISOString(),
        };
        authorize?.();
        this.store.saveOperation(running);
        try {
          const handle = await open(
            temp,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
            0o600,
          );
          try {
            if (operation.before !== null)
              await handle.chmod((await lstat(destination.target)).mode & 0o777);
            await handle.writeFile(operation.content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          const checked = await this.target(root, operation.path, operation.policy === 'access-v1');
          const currentParent = await lstat(checked.parent);
          if (
            checked.path !== destination.path ||
            currentParent.ino !== parentIdentity.ino ||
            currentParent.dev !== parentIdentity.dev ||
            (await this.current(root, operation.path, operation.policy === 'access-v1')) !==
              operation.before
          )
            throw new AppError(
              409,
              'file_changed',
              'The destination changed while applying the artifact. Reconcile before retrying.',
            );
          authorize?.();
          if (operation.before === null)
            await link(temp, destination.target); // Exclusive creation: never clobber a new file.
          else await rename(temp, destination.target);
          const parent = await open(destination.parent, constants.O_RDONLY);
          try {
            await parent.sync();
          } finally {
            await parent.close();
          }
          await this.afterWrite?.();
          const applied: Operation = {
            ...running,
            status: 'applied',
            resolvedAt: new Date().toISOString(),
          };
          this.store.saveOperation(applied);
          return applied;
        } catch (error) {
          this.store.saveOperation({ ...running, status: 'unknown' });
          throw error;
        } finally {
          await rm(temp, { force: true });
        }
      } finally {
        this.fileLocks.delete(destination.target);
      }
    });
  }
  async reconcile(id: string) {
    const initial = this.store.operation(id);
    return this.locked(initial.projectId, async () => {
      const operation = this.store.operation(id);
      if (!['unknown', 'conflict'].includes(operation.status))
        throw new AppError(
          409,
          'not_unknown',
          'Only an interrupted or conflicting change needs reconciliation.',
        );
      const root = this.store.project(operation.projectId).root;
      const destination = await this.target(root, operation.path, operation.policy === 'access-v1');
      if (operation.policy === 'access-v1' && destination.path !== operation.path)
        throw new AppError(
          409,
          'path_changed',
          'The recorded path changed. Restore it before reconciliation.',
        );
      const current = await this.current(root, operation.path, operation.policy === 'access-v1');
      const status =
        current === operation.content
          ? 'applied'
          : current === operation.before
            ? 'pending'
            : 'conflict';
      const temp = join(
        (await this.target(root, operation.path, operation.policy === 'access-v1')).parent,
        `.a0-slim-${operation.id}.tmp`,
      );
      try {
        const handle = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          if (
            (await handle.stat()).size <= 256 * 1024 &&
            (await handle.readFile('utf8')) === operation.content
          )
            await rm(temp);
        } finally {
          await handle.close();
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const next: Operation = {
        ...operation,
        status,
        approvedAt: undefined,
        resolvedAt: new Date().toISOString(),
      };
      this.store.saveOperation(next);
      return next;
    });
  }
  reject(id: string, digest: string, acknowledgeConflict = false) {
    const operation = this.store.operation(id);
    if (
      this.locks.has(operation.projectId) ||
      !['pending', 'conflict'].includes(operation.status) ||
      operation.digest !== digest
    )
      throw new AppError(409, 'artifact_busy', 'Reconcile this change before dismissing it.');
    if (operation.status === 'conflict' && !acknowledgeConflict)
      throw new AppError(
        409,
        'review_conflict',
        'Review the current file before resolving this conflict.',
      );
    const next: Operation = {
      ...operation,
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
    };
    this.store.saveOperation(next);
    return next;
  }
  tool(projectId: string, access?: Access): FxAgentHostTool {
    return {
      name: 'write_file',
      description: access
        ? 'Write a text file (max 256 KiB), keeping a diff and atomic receipt. Relative, absolute and ~/ paths are supported. The access mode may pause for approval; approval resumes this call. Existing parent directories are required.'
        : 'Propose a text artifact or replacement (max 256 KiB). This stages a preview for human approval; it does NOT write the project. Existing parent directories are required. Never claim it was applied.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      idempotent: true,
      writes: true,
      execute: async (input, context) => {
        context.signal.throwIfAborted();
        const saved = context.context as { messageId?: string } | undefined;
        const operation = await this.propose(
          projectId,
          context.sessionId,
          context.executionId,
          saved?.messageId ?? '',
          input,
        );
        if (access && operation.status === 'pending') {
          const path = await accessPath(this.store.project(projectId).root, operation.path, true);
          try {
            const check = await access.authorize(access.context(projectId, context), {
              kind: 'write',
              title: 'Edit file',
              target: path.target,
              outside: path.outside,
              sensitive: path.sensitive,
              fingerprint: operation.digest,
              details: `Before (up to 16000 characters):\n${(operation.before ?? '(new file)').slice(0, 16000)}\nAfter (up to 16000 characters):\n${operation.content.slice(0, 16000)}`,
            });
            const applied = await this.apply(operation.id, operation.digest, check);
            return { artifactId: applied.id, path: applied.path, status: applied.status };
          } catch (error) {
            if (this.store.operation(operation.id).status === 'pending')
              this.reject(operation.id, operation.digest);
            throw error;
          }
        }
        return {
          artifactId: operation.id,
          path: operation.path,
          status: operation.status,
          message: 'Review this artifact in A0 SLIM. Only the user can approve application.',
        };
      },
    };
  }
}
