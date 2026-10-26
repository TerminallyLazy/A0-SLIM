import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
export async function delegationModel(mode: 'normal' | 'nested' | 'slow' | 'loop' = 'normal') {
  const requests: any[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    const input = JSON.parse(body);
    requests.push(input);
    const names = input.tools?.map((t: any) => t.function.name) ?? [];
    const child = !names.includes('write_file');
    const latest = input.messages.findLastIndex((m: any) => m.role === 'user');
    const hasResult = input.messages.slice(latest + 1).some((m: any) => m.role === 'tool');
    const prompt = String(input.messages[latest]?.content ?? '');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    const finish = () => {
      timers.delete(timer!);
      if (res.destroyed) return;
      if (!hasResult || (child && mode === 'loop')) {
        const delegate = names.includes('call_subordinate') && (!child || mode === 'nested');
        const context = prompt.match(/continue:([a-f0-9-]{36})/)?.[1];
        const name = delegate ? 'call_subordinate' : 'read_file';
        const args = delegate
          ? {
              message: context
                ? 'Continue the earlier review of note.txt and report the result.'
                : 'Inspect note.txt and report the result.',
              name: 'Review project note',
              ...(context ? { context_id: context } : {}),
            }
          : { path: 'note.txt' };
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'reused-call-id',
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        });
        chunk({}, 'tool_calls');
      } else {
        chunk({
          role: 'assistant',
          content:
            '## Findings\n\nThe project is **Paper Garden**. `note.txt` confirms the name.\n\n- Read the project note\n- Checked the result\n\n| Check | Result |\n| --- | --- |\n| Project name | Paper Garden |\n\n```js\nconsole.log("Paper Garden");\n```',
        });
        chunk({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (child && mode === 'slow') {
      timer = setTimeout(finish, 10000);
      timers.add(timer);
    } else finish();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
