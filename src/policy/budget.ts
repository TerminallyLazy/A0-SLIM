import type { Store } from '../storage/store.js';
import { AppError } from '../domain.js';
/** Persistent connection/project circuit budget, shared by its chats and preserved on restart. */
export class RequestBudget {
  constructor(
    private store: Store,
    private scope: string,
    private limit = 40,
    private windowMs = 600_000,
    private now = Date.now,
  ) {}
  consume() {
    const key = `budget:${this.scope}`,
      now = this.now();
    const raw = this.store.meta(key);
    let state: { startedAt: number; count: number } = raw
      ? JSON.parse(raw)
      : { startedAt: now, count: 0 };
    if (now - state.startedAt >= this.windowMs) state = { startedAt: now, count: 0 };
    if (state.count >= this.limit)
      throw new AppError(
        429,
        'request_budget',
        `This project/model connection reached its ${this.limit}-request limit. Wait for the 10-minute window to reset.`,
      );
    state.count++;
    this.store.setMeta(key, JSON.stringify(state));
  }
}
