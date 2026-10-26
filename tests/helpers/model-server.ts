import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FixtureRequest = {
  messages: Array<{ role: string; content?: unknown; tool_calls?: unknown[] }>;
  tools?: Array<{ function: { name: string } }>;
};

export async function startModelFixture(
  options: { delayMs?: number; tool?: string; toolInput?: unknown; alwaysTool?: boolean } = {},
) {
  const requests: FixtureRequest[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    let bytes = '';
    for await (const chunk of request) bytes += chunk;
    const input = JSON.parse(bytes) as FixtureRequest;
    requests.push(input);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'fixture-completion', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    const latestUser = input.messages.findLastIndex((message) => message.role === 'user');
    const hasToolResult = input.messages
      .slice(latestUser + 1)
      .some((message) => message.role === 'tool');
    if (options.tool && (options.alwaysTool || !hasToolResult)) {
      chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'fixture-call',
            type: 'function',
            function: { name: options.tool, arguments: JSON.stringify(options.toolInput ?? {}) },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else {
      chunk({ role: 'assistant' });
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      chunk({ content: 'Fixture completed.' });
      chunk({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
