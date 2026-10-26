import { createHash } from 'node:crypto';
import type { Vault } from './vault.js';
import { AppError } from '../domain.js';

export type ResponseItem = Record<string, any>;
type Segment = {
  requestHash: string;
  prefixHash: string;
  projection: ResponseItem[];
  output: ResponseItem[];
  usage?: Record<string, number>;
};
type Journal = { version: 1; segments: Segment[] };
export function canonicalJson(text: string) {
  const sorted = (value: any): any =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  return JSON.stringify(sorted(JSON.parse(text)));
}
const legacyFingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) => {
        if (item?.type === 'function_call' && typeof item.arguments === 'string')
          return { ...item, arguments: canonicalJson(item.arguments) };
        if (item?.type === 'function_call_output' && typeof item.output === 'string') {
          try {
            return { ...item, output: canonicalJson(item.output) };
          } catch {
            return item;
          }
        }
        return item;
      }),
    )
    .digest('hex');
const limit = 8 * 1024 * 1024;

/** Protocol-only state: never returned in the chat transcript or sent to another account. */
export class ResponseReplay {
  private memory: Journal = { version: 1, segments: [] };
  constructor(
    private vault?: Vault,
    private key?: string,
  ) {}
  private async load(): Promise<Journal> {
    const journal = this.vault && this.key ? await this.vault.get<Journal>(this.key) : this.memory;
    if (journal && journal.version !== 1)
      throw new AppError(409, 'replay_version', 'This chat requires a newer protocol journal.');
    return journal ?? { version: 1, segments: [] };
  }
  async prepare(request: { input: ResponseItem[]; [key: string]: unknown }) {
    const journal = await this.load();
    const requestHash = fingerprint(request);
    const cached = journal.segments.findLast((segment) => segment.requestHash === requestHash);
    const expanded: ResponseItem[] = [];
    const legacyPrefix: ResponseItem[] = [];
    for (let index = 0; index < request.input.length;) {
      const item = request.input[index]!;
      if (item.role !== 'assistant' && item.type !== 'function_call') {
        expanded.push(item);
        legacyPrefix.push(item);
        index++;
        continue;
      }
      const prefixHash = fingerprint(request.input.slice(0, index));
      const match = journal.segments.findLast(
        (segment) =>
          (segment.prefixHash === prefixHash ||
            segment.prefixHash === legacyFingerprint(request.input.slice(0, index)) ||
            segment.prefixHash === legacyFingerprint(legacyPrefix)) &&
          segment.projection.length > 0 &&
          fingerprint(segment.projection) ===
            fingerprint(request.input.slice(index, index + segment.projection.length)),
      );
      if (!match) {
        throw new AppError(
          409,
          'replay_mismatch',
          'This chat’s provider history changed or was compacted. Start a new chat with a reviewed summary; incomplete reasoning state will not be sent.',
        );
      }
      expanded.push(...match.output);
      legacyPrefix.push(...match.projection);
      index += match.projection.length;
    }
    return {
      input: expanded,
      cached,
      commit: async (output: ResponseItem[], usage?: Record<string, number>) => {
        const projection = projectOutput(output);
        const segment: Segment = {
          requestHash,
          prefixHash: fingerprint(request.input),
          projection,
          output,
          usage,
        };
        // Retrying a completed transport request reuses its result. It cannot change its history.
        const loaded = await this.load();
        const fresh: Journal = { version: 1, segments: [...loaded.segments] };
        const existing = fresh.segments.find((s) => s.requestHash === requestHash);
        if (existing && fingerprint(existing.output) !== fingerprint(output))
          throw new AppError(
            409,
            'replay_conflict',
            'Conflicting completions for the same model request.',
          );
        if (!existing) fresh.segments.push(segment);
        if (fresh.segments.length > 1024 || Buffer.byteLength(JSON.stringify(fresh)) > limit)
          throw new AppError(
            413,
            'replay_limit',
            'This chat has reached its protocol-history limit. Start a new chat with a reviewed summary.',
          );
        if (this.vault && this.key) await this.vault.set(this.key, fresh);
        else this.memory = fresh;
      },
    };
  }
}

/** The representation libfx retains; complete provider output remains beside it. */
export function projectOutput(output: ResponseItem[]): ResponseItem[] {
  let text = '';
  const calls: ResponseItem[] = [];
  const identities = new Set<string>();
  for (const item of output) {
    if (item.type === 'reasoning') {
      if (typeof item.encrypted_content !== 'string' || !item.encrypted_content)
        throw new AppError(
          502,
          'reasoning_missing',
          'The provider omitted encrypted reasoning state.',
        );
      if (typeof item.id !== 'string' || !Array.isArray(item.summary))
        throw new AppError(
          502,
          'reasoning_invalid',
          'The provider returned incomplete reasoning state.',
        );
    } else if (
      item.type === 'message' &&
      item.role === 'assistant' &&
      Array.isArray(item.content)
    ) {
      for (const part of item.content) {
        if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
        else if (part.type === 'refusal' && typeof part.refusal === 'string') text += part.refusal;
        else
          throw new AppError(
            502,
            'unsupported_output',
            'The provider returned unsupported message content.',
          );
      }
    } else if (item.type === 'function_call') {
      if (
        item.namespace !== 'a0_slim' ||
        typeof item.call_id !== 'string' ||
        !item.call_id ||
        typeof item.name !== 'string' ||
        typeof item.arguments !== 'string' ||
        identities.has(item.call_id)
      )
        throw new AppError(
          502,
          'invalid_call',
          'The provider returned an invalid function identity.',
        );
      JSON.parse(item.arguments);
      identities.add(item.call_id);
      calls.push({
        type: 'function_call',
        namespace: item.namespace,
        call_id: item.call_id,
        name: item.name,
        arguments: canonicalJson(item.arguments),
      });
    } else
      throw new AppError(
        502,
        'unsupported_output',
        'The provider returned an unsupported output item.',
      );
  }
  if (!text && !calls.length)
    throw new AppError(
      502,
      'empty_completion',
      'The provider completed without text or a tool call.',
    );
  return [
    ...(text ? [{ role: 'assistant', content: [{ type: 'output_text', text }] }] : []),
    ...calls,
  ];
}

export function replayKey(
  account: { connectionId: string; subject: string; clientId: string },
  sessionId: string,
  model: string,
) {
  return `responses:${fingerprint({ ...account, sessionId, model })}`;
}
