import type { FxFetch } from 'libfx';
import { AppError } from '../domain.js';

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
  const items: unknown[] = [];
  for (const message of input.messages) {
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
          arguments: call.function.arguments,
        });
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

/** Strict text/function bridge. Real provider acceptance is a separate release gate. */
export function responsesFetch(
  accessToken: () => Promise<string>,
  upstream: typeof fetch = fetch,
): FxFetch {
  return async (url, init) => {
    if (url !== `${CHATGPT_BRIDGE_URL}/chat/completions`)
      throw new Error('Unexpected ChatGPT bridge endpoint.');
    const request = toResponses(JSON.parse(String(init.body)) as ChatRequest);
    const abort = new AbortController();
    const signal = init.signal ? AbortSignal.any([init.signal, abort.signal]) : abort.signal;
    const source = await upstream('https://api.openai.com/v1/responses', {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    if (!source.ok || !source.body) {
      await source.body?.cancel();
      return Response.json(
        {
          error: {
            message: `ChatGPT request failed (HTTP ${source.status}). Check the account connection and usage limits.`,
            type: 'provider_error',
          },
        },
        { status: source.ok ? 502 : source.status },
      );
    }
    const encoder = new TextEncoder();
    const events = readSse(source.body)[Symbol.asyncIterator]();
    let completed = false,
      index = 0,
      outputBytes = 0;
    const calls = new Map<string, { index: number; name: string }>();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            const next = await events.next();
            if (next.done) {
              if (!completed) throw new Error('ChatGPT stream ended without response.completed.');
              controller.close();
              return;
            }
            const event = next.value;
            const send = (delta: unknown, finish_reason: string | null = null, usage?: unknown) => {
              const frame = `data: ${JSON.stringify({ id: 'a0-slim-responses', object: 'chat.completion.chunk', model: request.model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`;
              outputBytes += Buffer.byteLength(frame);
              if (outputBytes > 2_097_152)
                throw new Error('ChatGPT response exceeded the output limit.');
              controller.enqueue(encoder.encode(frame));
            };
            if (event.type === 'response.output_text.delta') {
              send({ content: event.delta });
              return;
            }
            if (
              event.type === 'response.output_item.added' &&
              event.item?.type === 'function_call'
            ) {
              const item = event.item;
              if (
                item.namespace !== namespace ||
                typeof item.call_id !== 'string' ||
                typeof item.id !== 'string' ||
                typeof item.name !== 'string'
              )
                throw new Error('Unsupported ChatGPT function namespace or identity.');
              const toolIndex = index++;
              calls.set(item.id, { index: toolIndex, name: item.name });
              send({
                tool_calls: [
                  {
                    index: toolIndex,
                    id: item.call_id,
                    type: 'function',
                    function: { name: item.name, arguments: item.arguments ?? '' },
                  },
                ],
              });
              return;
            }
            if (event.type === 'response.function_call_arguments.delta') {
              const call = calls.get(event.item_id);
              if (!call) throw new Error('Received arguments for an unknown ChatGPT tool call.');
              send({ tool_calls: [{ index: call.index, function: { arguments: event.delta } }] });
              return;
            }
            if (event.type === 'response.completed') {
              completed = true;
              const usage = event.response?.usage;
              send(
                {},
                calls.size ? 'tool_calls' : 'stop',
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
              throw new Error(
                'ChatGPT did not complete this response. Check account access and usage, then retry.',
              );
            }
            if (event.type === 'response.output_item.added' && event.item?.type === 'reasoning')
              throw new Error(
                'This model requires reasoning-state replay, which this experimental bridge does not yet support.',
              );
            if (event.type === 'response.output_item.added' && event.item?.type !== 'message')
              throw new Error('ChatGPT returned an unsupported tool type.');
          }
        } catch (error) {
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
