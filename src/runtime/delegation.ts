import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FxAgentHostTool, FxToolContext } from 'libfx';
import { AppError, type Chat } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Extensions } from '../extensions/runtime.js';

const inputSchema = z
  .object({
    message: z.string().trim().min(1).max(12000),
    name: z.string().trim().min(1).max(80).optional(),
    context_id: z.string().uuid().optional(),
  })
  .strict();
export type Delegation = {
  id: string;
  inputHash: string;
  parentChatId: string;
  parentMessageId: string;
  rootChatId: string;
  rootMessageId: string;
  childChatId: string;
  messageId: string;
  assignment: string;
  depth: number;
  deadline: number;
  createdAt: string;
  status: 'reserved' | 'running' | 'completed' | 'interrupted' | 'cancelled' | 'failed';
  text?: string;
  finishedAt?: string;
};
export const delegationLimits = {
  depth: 2,
  active: 2,
  calls: 6,
  requests: 8,
  durationMs: 120_000,
  resultChars: 16000,
} as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Delegations {
  private jobs = new Map<string, Promise<ReturnType<Delegations['result']>>>();
  constructor(
    private store: Store,
    private extensions: Extensions,
    private run: (
      record: Delegation,
      signal: AbortSignal,
    ) => Promise<{ stopReason: string; text: string }>,
  ) {
    for (const record of this.list())
      if (record.status === 'running' || record.status === 'reserved') {
        this.save({ ...record, status: 'interrupted', finishedAt: new Date().toISOString() });
        const child = store.chat(record.childChatId);
        store.saveChat({
          ...child,
          status: 'interrupted',
          lastStop:
            'Subordinate work was interrupted. Inspect its saved transcript before continuing it from the parent chat.',
        });
      }
  }
  list() {
    return this.store.records<Delegation>('delegation');
  }
  save(record: Delegation) {
    this.store.record('delegation', record);
  }
  private result(record: Delegation) {
    return {
      context_id: record.childChatId,
      status: record.status,
      text: record.text ?? '',
      ...(record.status === 'interrupted'
        ? {
            notice:
              'This existing child was interrupted. Inspect it and continue with context_id on a new parent turn; do not recreate the assignment.',
          }
        : {}),
    };
  }
  tool(projectId: string): FxAgentHostTool {
    return {
      name: 'call_subordinate',
      description:
        'Delegate a bounded research/review assignment to a separate child chat using this project and model. Children have only file reads, allowed skills and memory recall. Waits for their result. Use context_id to continue a direct child. Maximum depth 2, two active children and six calls per root turn.',
      inputSchema: z.toJSONSchema(inputSchema),
      idempotent: true,
      writes: false,
      execute: (input, ctx) => this.call(projectId, input, ctx),
    };
  }
  async call(projectId: string, input: unknown, ctx: FxToolContext) {
    const request = inputSchema.parse(input);
    const parent = this.store
      .chats()
      .find((c) => c.projectId === projectId && c.sessionId === ctx.sessionId);
    const messageId = (ctx.context as { messageId?: string })?.messageId;
    if (
      !parent ||
      !messageId ||
      !parent.delegationVersion ||
      (parent.depth ?? 0) >= delegationLimits.depth
    )
      throw new AppError(
        403,
        'delegation_scope',
        'Subordinate creation is not available in this chat.',
      );
    const ceiling = this.extensions.context(projectId, ctx);
    const id = hash(`${parent.id}:${messageId}:${ctx.executionId}`),
      inputHash = hash(JSON.stringify(request));
    const prior = this.list().find((r) => r.id === id);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new AppError(
          409,
          'delegation_reused',
          'This subordinate call ID belongs to a different assignment.',
        );
      return this.jobs.get(id) ?? this.result(prior);
    }
    ctx.signal.throwIfAborted();
    const parentRecord = parent.parentChatId
      ? this.list().find((r) => r.childChatId === parent.id && r.messageId === messageId)
      : undefined;
    if (parent.parentChatId && parentRecord?.status !== 'running')
      throw new AppError(
        403,
        'delegation_scope',
        'No active parent assignment owns this child turn.',
      );
    const rootChatId = parentRecord?.rootChatId ?? parent.id,
      rootMessageId = parentRecord?.rootMessageId ?? messageId;
    const rootDeadline = Number(this.store.meta(`turn-deadline:${rootChatId}:${rootMessageId}`));
    if (!rootDeadline || rootDeadline <= Date.now())
      throw new AppError(409, 'delegation_expired', 'The parent turn has no remaining time.');
    const rootCalls = this.list().filter(
      (r) => r.rootChatId === rootChatId && r.rootMessageId === rootMessageId,
    );
    const history = this.list();
    const unresolved = history.find(
      (r, index) =>
        r.parentChatId === parent.id &&
        r.status === 'interrupted' &&
        !history.slice(0, index).some((later) => later.childChatId === r.childChatId),
    );
    if (
      unresolved &&
      (request.context_id !== unresolved.childChatId || unresolved.rootMessageId === rootMessageId)
    )
      return this.result(unresolved);
    if (rootCalls.length >= delegationLimits.calls)
      throw new AppError(
        429,
        'delegation_limit',
        'This parent turn reached its six-assignment limit.',
      );
    if (
      rootCalls.filter((r) => ['reserved', 'running'].includes(r.status)).length >=
      delegationLimits.active
    )
      throw new AppError(
        429,
        'delegation_busy',
        'Two subordinate assignments are already active. Wait for one to finish.',
      );
    let child: Chat;
    if (request.context_id) {
      child = this.store.chat(request.context_id);
      if (
        child.parentChatId !== parent.id ||
        child.projectId !== projectId ||
        child.connectionId !== parent.connectionId ||
        child.model !== parent.model
      )
        throw new AppError(
          403,
          'delegation_scope',
          'Only a direct child with the same project and model can be continued.',
        );
      if (
        this.list().some(
          (r) => r.childChatId === child.id && ['running', 'reserved'].includes(r.status),
        )
      )
        throw new AppError(409, 'delegation_busy', 'This subordinate is still working.');
    } else
      child = {
        id: randomUUID(),
        title: request.name ?? request.message.slice(0, 70),
        projectId,
        connectionId: parent.connectionId,
        model: parent.model,
        sessionId: null,
        status: 'idle',
        capabilitiesVersion: 2,
        delegationVersion: 1,
        parentChatId: parent.id,
        rootChatId,
        depth: (parent.depth ?? 0) + 1,
        execution: 'none',
        createdAt: new Date().toISOString(),
      };
    const record: Delegation = {
      id,
      inputHash,
      parentChatId: parent.id,
      parentMessageId: messageId,
      rootChatId,
      rootMessageId,
      childChatId: child.id,
      messageId: randomUUID(),
      assignment: request.message,
      depth: child.depth!,
      deadline: Math.min(
        rootDeadline,
        parentRecord?.deadline ?? rootDeadline,
        Date.now() + delegationLimits.durationMs,
      ),
      createdAt: new Date().toISOString(),
      status: 'reserved',
    };
    this.store.db.transaction(() => {
      this.store.saveChat(child);
      this.extensions.snapshot(projectId, child.id, record.messageId, record.assignment, ceiling);
      this.save(record);
    })();
    const work = (async () => {
      try {
        ctx.signal.throwIfAborted();
        this.save({ ...record, status: 'running' });
        const result = await this.run(record, ctx.signal);
        const status =
          ctx.signal.aborted || result.stopReason === 'cancelled'
            ? 'cancelled'
            : result.stopReason === 'end_turn'
              ? 'completed'
              : result.stopReason === 'unknown'
                ? 'interrupted'
                : 'failed';
        const final: Delegation = {
          ...record,
          status,
          text: result.text.slice(0, delegationLimits.resultChars),
          finishedAt: new Date().toISOString(),
        };
        this.save(final);
        return this.result(final);
      } catch (error) {
        const final: Delegation = {
          ...record,
          status:
            error instanceof AppError && error.code === 'delegation_recovery_unknown'
              ? 'interrupted'
              : ctx.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
                ? 'cancelled'
                : 'failed',
          finishedAt: new Date().toISOString(),
        };
        this.save(final);
        return this.result(final);
      } finally {
        this.jobs.delete(id);
      }
    })();
    this.jobs.set(id, work);
    return work;
  }
}
