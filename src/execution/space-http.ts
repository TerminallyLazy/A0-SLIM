import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../domain.js';

export const spaceError = (message: string) => new AppError(409, 'space_check', message);
export function spaceOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw spaceError('Enter a complete SPACE URL.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw spaceError(
      'Use an HTTPS origin without a path, credentials or query. HTTP is allowed only on loopback.',
    );
  return url.origin;
}

// Native requests deliberately ignore proxy environment variables and never follow redirects.
export async function spaceRequest(
  url: string,
  options: {
    token?: string;
    method?: string;
    body?: string;
    key?: string;
    signal: AbortSignal;
    accept?: string;
  },
): Promise<IncomingMessage> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = (target.protocol === 'https:' ? https : http).request(
      target,
      {
        method: options.method ?? 'GET',
        signal: options.signal,
        agent: false,
        headers: {
          accept: options.accept ?? 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.key ? { 'idempotency-key': options.key } : {}),
          ...(options.body !== undefined
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(options.body),
              }
            : {}),
        },
      },
      resolve,
    );
    req.on('error', () =>
      reject(
        spaceError(
          'SPACE could not be reached or the request timed out. Its outcome may be unknown.',
        ),
      ),
    );
    req.end(options.body);
  });
}
export async function readJSON(response: IncomingMessage): Promise<Record<string, any>> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw spaceError('SPACE response exceeded the size limit.');
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw spaceError('SPACE returned an incomplete or invalid JSON response.');
  } finally {
    response.destroy();
  }
}
export function httpFailure(status: number | undefined, body: Record<string, any>): AppError {
  const code =
    typeof body.code === 'string' && /^[a-z_]{1,80}$/.test(body.code) ? ` (${body.code})` : '';
  const request =
    typeof body.request_id === 'string' && /^[\w-]{1,100}$/.test(body.request_id)
      ? ` Request ${body.request_id}.`
      : '';
  return spaceError(
    `SPACE returned HTTP ${status ?? 'unknown'}${code}.${request} Check the server and account; absence is not deletion evidence.`,
  );
}

export const spaceExpectedOutput = 'A0 SLIM SPACE SYNTHETIC PROOF\n';
// Only terminal process evidence plus exact bytes can pass. Never reconnect or restart a command here.
export async function readSpaceEvents(
  response: AsyncIterable<Uint8Array>,
  processId: string,
): Promise<void> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '',
    event = '',
    data: string[] = [],
    total = 0,
    ended = false,
    stdout = Buffer.alloc(0);
  let lastSequence = -1;
  const frame = () => {
    if (!data.length) {
      event = '';
      return;
    }
    let value: any;
    try {
      value = JSON.parse(data.join('\n'));
    } catch {
      throw spaceError('SPACE sent an invalid event.');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.type !== 'string' ||
      (event && event !== value.type)
    )
      throw spaceError('SPACE sent an invalid event.');
    event ||= value.type;
    if (['error', 'resync_required'].includes(event))
      throw spaceError('SPACE reported an output error or a gap in its event stream.');
    if (['stdout', 'stderr'].includes(event)) {
      if (
        ended ||
        typeof value.data_base64 !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data_base64)
      )
        throw spaceError('SPACE returned invalid or late output.');
      if (!Number.isSafeInteger(value.seq) || value.seq <= lastSequence)
        throw spaceError('SPACE output sequence is invalid.');
      lastSequence = value.seq;
      const bytes = Buffer.from(value.data_base64, 'base64');
      if (event === 'stderr' && bytes.length)
        throw spaceError('The SPACE synthetic command reported an error.');
      stdout = Buffer.concat([stdout, bytes]);
      if (stdout.length > 8192) throw spaceError('SPACE output exceeded the check limit.');
    }
    if (event === 'process_started' && value.process_id !== processId)
      throw spaceError('SPACE returned a different process.');
    if (event === 'process_exited') {
      if (
        ended ||
        value.process_id !== processId ||
        value.exit_code !== 0 ||
        value.status !== 'exited'
      )
        throw spaceError('The SPACE process did not exit successfully.');
      ended = true;
    }
    event = '';
    data = [];
  };
  for await (const bytes of response) {
    total += bytes.byteLength;
    if (total > 256 * 1024) throw spaceError('SPACE event stream exceeded the check limit.');
    pending += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (!line) {
        frame();
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':'),
        field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
  }
  pending += decoder.decode();
  if (pending || data.length || !ended || !stdout.equals(Buffer.from(spaceExpectedOutput)))
    throw spaceError('SPACE output was incomplete or did not match the synthetic note.');
}
