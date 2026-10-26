import type { FxSession } from 'libfx';

/** Wait for the abandoned turn's terminal event without starting another turn view. */
export async function stopInterruptedTurn(
  session: Pick<FxSession, 'stream' | 'cancel'>,
  messageId: string,
  signal: AbortSignal,
  timeoutMs: number,
) {
  const reader = session.stream().getReader(),
    decoder = new TextDecoder();
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  const timeout = setTimeout(stop, Math.max(0, timeoutMs));
  signal.addEventListener('abort', stop, { once: true });
  let pending = '';
  try {
    if (signal.aborted) return false;
    await session.cancel();
    while (true) {
      const part = await reader.read();
      if (part.done) return false;
      pending += decoder.decode(part.value, { stream: true });
      if (pending.length > 512 * 1024) return false;
      const lines = pending.split('\n');
      pending = lines.pop()!;
      for (const line of lines)
        if (line) {
          const event = JSON.parse(line);
          if (event.type === 'turn_end' && event.messageId === messageId)
            return ['cancelled', 'end_turn', 'error'].includes(event.stopReason);
        }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
