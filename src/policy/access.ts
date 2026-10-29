import { createHash, randomUUID } from 'node:crypto';
import type { FxToolContext } from 'libfx';
import type { Store } from '../storage/store.js';
import { AppError } from '../domain.js';

export type AccessMode = 'full' | 'auto' | 'ask';
export type AccessSelection = { mode: AccessMode; revision: string };
export const defaultAccess = (): AccessSelection => ({ mode: 'auto', revision: randomUUID() });
export type Action = {
  kind: 'read' | 'write' | 'web' | 'bash' | 'mcp' | 'acp';
  title: string;
  target: string;
  details?: string;
  fingerprint?: string;
  outside?: boolean;
  sensitive?: boolean;
  network?: boolean;
  knownRead?: boolean;
};
export type AccessContext = {
  projectId: string;
  chatId: string;
  messageId: string;
  callId: string;
  revision: string;
  signal: AbortSignal;
};
export type AccessDecision = {
  id: string;
  projectId: string;
  chatId: string;
  messageId: string;
  callId: string;
  revision: string;
  digest: string;
  action: Action;
  reason: string;
  authority: 'mode' | 'user';
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  createdAt: string;
};
const fail = (message: string) => new AppError(409, 'access_changed', message);
export function accessRisk(mode: AccessMode, a: Action): string | undefined {
  if (mode === 'full') return;
  if (a.sensitive)
    return a.kind === 'web'
      ? 'This request uses a private address or may send data in its URL.'
      : 'This action accesses sensitive files or changes executable configuration.';
  if (a.outside) return 'This action accesses files outside this project.';
  if (a.kind === 'bash' || a.kind === 'acp' || (a.kind === 'mcp' && !a.knownRead))
    return 'The effects of this command or external tool cannot be established in advance.';
  if (mode === 'ask' && a.kind === 'write') return 'Your access mode asks before editing files.';
  if (mode === 'ask' && a.network) return 'Your access mode asks before using the internet.';
}
export class Access {
  private waiting = new Map<string, () => void>();
  constructor(private store: Store) {
    for (const d of this.list())
      if (d.status === 'pending') this.save({ ...d, status: 'cancelled' });
  }
  list() {
    return this.store.records<AccessDecision>('access-decision');
  }
  private save(d: AccessDecision) {
    this.store.record('access-decision', d);
  }
  capture(projectId: string, chatId: string, messageId: string) {
    const selection = this.store.project(projectId).access;
    if (!selection) throw fail('Choose an access mode before using updated tools.');
    const key = `access-turn:${chatId}:${messageId}`;
    if (!this.store.meta(key)) this.store.setMeta(key, selection.revision);
  }
  context(projectId: string, ctx: FxToolContext): AccessContext {
    const chat = this.store
      .chats()
      .find((c) => c.projectId === projectId && c.sessionId === ctx.sessionId);
    const messageId = (ctx.context as { messageId?: string })?.messageId;
    const revision = chat && messageId && this.store.meta(`access-turn:${chat.id}:${messageId}`);
    if (!chat?.accessVersion || chat.parentChatId || !messageId || !revision)
      throw fail('This action has no accepted access snapshot. Start a chat with updated tools.');
    return {
      projectId,
      chatId: chat.id,
      messageId,
      callId: ctx.executionId,
      revision,
      signal: ctx.signal,
    };
  }
  change(projectId: string, mode: AccessMode) {
    this.store.saveProject({
      ...this.store.project(projectId),
      access: { mode, revision: randomUUID() },
      hostBashGrant: undefined,
    });
    for (const d of this.list())
      if (d.projectId === projectId && d.status === 'pending') {
        this.save({ ...d, status: 'cancelled' });
        this.waiting.get(d.id)?.();
      }
  }
  invalidate(projectId: string, fingerprint: string) {
    for (const d of this.list())
      if (
        d.projectId === projectId &&
        d.action.fingerprint === fingerprint &&
        d.status === 'pending'
      ) {
        this.save({ ...d, status: 'cancelled' });
        this.waiting.get(d.id)?.();
      }
  }
  decide(id: string, digest: string, allow: boolean) {
    const d = this.list().find((d) => d.id === id);
    if (!d || d.digest !== digest) throw fail('This approval no longer matches the action.');
    if (d.status !== 'pending') return d;
    if (this.store.project(d.projectId).access?.revision !== d.revision)
      throw fail('Access settings changed.');
    const next = {
      ...d,
      status: allow ? ('approved' as const) : ('denied' as const),
      authority: 'user' as const,
    };
    this.save(next);
    this.waiting.get(id)?.();
    return next;
  }
  async authorize(ctx: AccessContext, action: Action): Promise<() => void> {
    const check = () => {
      ctx.signal.throwIfAborted();
      if (this.store.project(ctx.projectId).access?.revision !== ctx.revision)
        throw fail('Access settings changed. Continue in a new turn.');
    };
    check();
    const digest = createHash('sha256')
      .update(JSON.stringify({ action, revision: ctx.revision }))
      .digest('hex');
    let decision = this.list().find(
      (d) => d.chatId === ctx.chatId && d.messageId === ctx.messageId && d.callId === ctx.callId,
    );
    if (decision && decision.digest !== digest)
      throw fail('A repeated action changed its arguments.');
    if (!decision) {
      const reason = accessRisk(this.store.project(ctx.projectId).access!.mode, action);
      decision = {
        id: randomUUID(),
        projectId: ctx.projectId,
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        callId: ctx.callId,
        revision: ctx.revision,
        digest,
        action,
        reason: reason ?? 'Allowed by the selected access mode.',
        authority: 'mode',
        status: reason ? 'pending' : 'approved',
        createdAt: new Date().toISOString(),
      };
      this.save(decision);
    }
    const id = decision.id;
    if (decision.status === 'pending') {
      if (this.waiting.has(id)) throw fail('This action is already awaiting approval.');
      await new Promise<void>((resolve) => {
        const finish = () => {
          ctx.signal.removeEventListener('abort', cancel);
          this.waiting.delete(id);
          resolve();
        };
        const cancel = () => {
          const current = this.list().find((d) => d.id === id)!;
          if (current.status === 'pending') this.save({ ...current, status: 'cancelled' });
          finish();
        };
        this.waiting.set(id, finish);
        ctx.signal.addEventListener('abort', cancel, { once: true });
        if (ctx.signal.aborted) cancel();
      });
    }
    check();
    if (this.list().find((d) => d.id === id)?.status !== 'approved')
      throw new AppError(
        403,
        'access_denied',
        'The action was denied or cancelled. Do not repeat it without new user direction.',
      );
    return check;
  }
}
