import type { FxFetch } from 'libfx';
import { AppError } from '../domain.js';
import { ResponseReplay, projectOutput, canonicalJson, type ResponseItem } from './replay.js';

export const CHATGPT_BRIDGE_URL = 'https://chatgpt.a0-slim.invalid/v1';
const namespace = 'a0_slim';
type ChatMessage = {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
};
type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{ type: string; function: Record<string, unknown> }>;
};

export function toResponses(input: ChatRequest) {
  if (!Array.isArray(input.messages) || typeof input.model !== 'string')
    throw new AppError(400, 'bridge_request', 'Unsupported model request.');
  const instructions: string[] = [];
  const items: ResponseItem[] = [];
  const supplemental: ResponseItem[] = [];
  const fileEvidence = new Set<string>();
  for (const [index, message] of input.messages.entries()) {
    // The initial bridge intentionally supports text and functions only.
    if (
      message.content !== null &&
      message.content !== undefined &&
      typeof message.content !== 'string'
    )
      throw new AppError(
        400,
        'bridge_capability',
        'This ChatGPT bridge currently supports text input only.',
      );
    const content = String(message.content ?? '');
    // libfx 0.0.14 inserts a file-evidence note before the last assistant message on
    // restoration. It was never part of the original provider request. Recognize
    // only exact metadata lines backed by preceding file calls, and retain them
    // as user-level context beside the next prompt, never as system instructions.
    const evidenceLines = content.split('\n');
    if (
      message.role === 'user' &&
      input.messages[index + 1]?.role === 'assistant' &&
      evidenceLines[0] ===
        'Session file evidence from previous tool execution. Re-read stale paths before relying on exact contents:' &&
      evidenceLines.length > 1 &&
      evidenceLines.slice(1).every((line) => fileEvidence.has(line))
    ) {
      supplemental.push({ role: 'user', content: [{ type: 'input_text', text: content }] });
      continue;
    }
    if (message.role === 'system' || message.role === 'developer') instructions.push(content);
    else if (message.role === 'tool') {
      if (!message.tool_call_id)
        throw new AppError(400, 'bridge_call_id', 'A tool result is missing its call ID.');
      items.push({ type: 'function_call_output', call_id: message.tool_call_id, output: content });
    } else if (message.role === 'user' || message.role === 'assistant') {
      if (content)
        items.push({
          role: message.role,
          content: [
            { type: message.role === 'user' ? 'input_text' : 'output_text', text: content },
          ],
        });
      for (const call of message.tool_calls ?? []) {
        if (call.type !== 'function')
          throw new AppError(
            400,
            'bridge_tool',
            'Only function tools are supported by this bridge.',
          );
        items.push({
          type: 'function_call',
          namespace,
          call_id: call.id,
          name: call.function.name,
          arguments: canonicalJson(call.function.arguments),
        });
        if (['read_file', 'write_file'].includes(call.function.name)) {
          const args = JSON.parse(call.function.arguments);
          if (typeof args.path === 'string' && !/[\r\n]/.test(args.path))
            fileEvidence.add(
              `- action=${call.function.name === 'read_file' ? 'read' : 'write'} status=success path=${args.path} tool=${call.function.name}`,
            );
        }
      }
    } else throw new AppError(400, 'bridge_role', 'Unsupported message role.');
  }
  const functions = (input.tools ?? []).map((tool) => {
    if (tool.type !== 'function' || typeof tool.function?.name !== 'string')
      throw new AppError(400, 'bridge_tool', 'Only function tools are supported by this bridge.');
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description ?? '',
      parameters: tool.function.parameters,
      strict: false,
    };
  });
  return {
    model: input.model,
    input: items,
    supplemental,
    instructions: instructions.join('\n\n'),
    store: false,
    stream: true,
    ...(functions.length
      ? {
          tools: [
            {
              type: 'namespace',
              name: namespace,
              description: 'Tools for this A0 SLIM project.',
              tools: functions,
            },
          ],
        }
      : {}),
  };
}

export async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (frame.length > 1_048_576) throw new Error('Provider event exceeded the size limit.');
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data) as Record<string, any>;
      }
      if (buffer.length > 1_048_576) throw new Error('Provider event exceeded the size limit.');
      if (part.done) break;
    }
    if (buffer.trim()) throw new Error('Provider stream ended inside an event.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Responses stays stateless remotely; completed protocol state is committed locally before tools are released. */
export function responsesFetch(
  accessToken: () => Promise<string>,
  upstream: typeof fetch = fetch,
  selectReplay?: (init: RequestInit, model: string) => ResponseReplay | Promise<ResponseReplay>,
  onFailure?: (init: RequestInit, message: string) => void,
  onProtocol?: (
    init: RequestInit,
    shape: {
      terminalItems: number;
      completedItems: number;
      usedCompletedItems: boolean;
      cached: boolean;
    },
  ) => void,
): FxFetch {
  const fallback = new ResponseReplay();
  return async (url, init) => {
    if (url !== `${CHATGPT_BRIDGE_URL}/chat/completions`)
      throw new Error('Unexpected ChatGPT bridge endpoint.');
    const request = toResponses(JSON.parse(String(init.body)) as ChatRequest);
    const replay = selectReplay ? await selectReplay(init, request.model) : fallback;
    const prepared = await replay.prepare(request).catch((error) => {
      if (error instanceof AppError) onFailure?.(init, error.message);
      throw error;
    });
    const abort = new AbortController();
    const signal = init.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;
    signal.throwIfAborted();
    let source: Response;
    if (prepared.cached) {
      source = new Response(
        `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: prepared.cached.output, usage: prepared.cached.usage } })}\n\n`,
      );
    } else {
      const { supplemental, ...wireRequest } = request;
      const history = [...prepared.input];
      const last = history.at(-1);
      if (supplemental.length)
        history.splice(
          last?.role === 'user' ? history.length - 1 : history.length,
          0,
          ...supplemental,
        );
      source = await upstream('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...wireRequest, input: history }),
      });
    }
    if (!source.ok || !source.body) {
      await source.body?.cancel();
      const message =
        source.status === 401
          ? 'ChatGPT rejected this account connection. Reconnect it.'
          : source.status === 429
            ? 'ChatGPT usage is currently limited. Wait or review the account limits.'
            : `ChatGPT request failed (HTTP ${source.status}). Check the connection.`;
      onFailure?.(init, message);
      return Response.json(
        { error: { message, type: 'provider_error' } },
        { status: source.ok ? 502 : source.status },
      );
    }
    const encoder = new TextEncoder(),
      events = readSse(source.body)[Symbol.asyncIterator]();
    const completedItems = new Map<number, ResponseItem>();
    const addedIndices = new Set<number>();
    let streamedText = '',
      completedBytes = 0,
      outputBytes = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            signal.throwIfAborted();
            const next = await events.next();
            if (next.done) throw new Error('ChatGPT stream ended without response.completed.');
            const event = next.value;
            const send = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => {
              const frame = `data: ${JSON.stringify({ id: 'a0-slim-responses', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
              outputBytes += Buffer.byteLength(frame);
              if (outputBytes > 2_097_152)
                throw new Error('ChatGPT response exceeded the output limit.');
              controller.enqueue(encoder.encode(frame));
            };
            if (event.type === 'response.output_item.added' && Number.isInteger(event.output_index))
              addedIndices.add(event.output_index);
            if (event.type === 'response.output_item.done') {
              if (
                !Number.isInteger(event.output_index) ||
                event.output_index < 0 ||
                event.output_index > 255 ||
                !event.item ||
                completedItems.has(event.output_index)
              )
                throw new Error('Invalid completed output identity.');
              completedBytes += Buffer.byteLength(JSON.stringify(event.item));
              if (completedBytes > 8 * 1024 * 1024)
                throw new Error('Completed protocol output exceeded its limit.');
              completedItems.set(event.output_index, event.item);
            }
            if (event.type === 'response.output_text.delta') {
              if (typeof event.delta !== 'string') throw new Error('Invalid text delta.');
              streamedText += event.delta;
              send({ content: event.delta });
              return;
            }
            if (event.type === 'response.completed') {
              if (event.response?.status !== 'completed' || !Array.isArray(event.response?.output))
                throw new Error('ChatGPT did not return a complete output record.');
              const terminal = event.response.output as ResponseItem[];
              onProtocol?.(init, {
                terminalItems: terminal.length,
                completedItems: completedItems.size,
                usedCompletedItems: !terminal.length && completedItems.size > 0,
                cached: !!prepared.cached,
              });
              // Some subscription streams omit output from the terminal envelope. Only fully
              // completed item events are eligible, and only after response.completed succeeds.
              const output = terminal.length
                ? terminal
                : [...completedItems.entries()]
                    .sort(([a], [b]) => a - b)
                    .map(([index, item], position) => {
                      if (index !== position) throw new Error('Missing completed output item.');
                      return item;
                    });
              if ([...addedIndices].some((index) => !output[index]))
                throw new Error('Unfinished output item.');
              if (
                terminal.length &&
                [...completedItems].some(
                  ([index, item]) =>
                    terminal[index]?.id !== item.id || terminal[index]?.type !== item.type,
                )
              )
                throw new Error('Completed output identity changed.');
              const projection = projectOutput(output);
              const text =
                projection.find((item) => item.role === 'assistant')?.content[0].text ?? '';
              if (!text.startsWith(streamedText))
                throw new Error('Completed response did not match streamed text.');
              signal.throwIfAborted();
              await prepared.commit(output, event.response.usage);
              signal.throwIfAborted();
              if (text.length > streamedText.length)
                send({ content: text.slice(streamedText.length) });
              const calls = projection.filter((item) => item.type === 'function_call');
              if (calls.length)
                send({
                  tool_calls: calls.map((call, index) => ({
                    index,
                    id: call.call_id,
                    type: 'function',
                    function: { name: call.name, arguments: call.arguments },
                  })),
                });
              const usage = event.response.usage;
              send(
                {},
                calls.length ? 'tool_calls' : 'stop',
                usage
                  ? {
                      prompt_tokens: usage.input_tokens,
                      completion_tokens: usage.output_tokens,
                      total_tokens: usage.total_tokens,
                    }
                  : undefined,
              );
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              await events.return?.();
              controller.close();
              return;
            }
            if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
              const code = event.response?.error?.code ?? event.error?.code ?? event.code;
              const limited = [
                'subscription_sharing_usage_limit_exceeded',
                'subscription_sharing_usage_unavailable',
              ].includes(code);
              throw new AppError(
                limited ? 429 : 502,
                limited ? 'usage_limited' : 'inference_incomplete',
                limited
                  ? 'ChatGPT plan usage is currently unavailable or limited. Review account limits or wait before retrying.'
                  : 'ChatGPT did not complete this response. Check account access and usage, then retry.',
              );
            }
            if (
              event.type === 'response.output_item.added' &&
              !['message', 'reasoning', 'function_call'].includes(event.item?.type)
            )
              throw new Error('ChatGPT returned an unsupported output type.');
          }
        } catch (error) {
          if (error instanceof AppError) onFailure?.(init, error.message);
          abort.abort();
          await events.return?.();
          controller.error(error);
        }
      },
      async cancel() {
        abort.abort();
        await events.return?.();
      },
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
}
