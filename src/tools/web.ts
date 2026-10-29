import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { FxAgentHostTool } from 'libfx';
import { z } from 'zod';
import type { Access } from '../policy/access.js';
import { AppError } from '../domain.js';
const privateIPs = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  privateIPs.addSubnet(ip, prefix);
for (const [ip, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2001::', 32],
] as const)
  privateIPs.addSubnet(ip, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
export function privateAddress(address: string) {
  if (isIP(address) === 6 && !globalV6.check(address, 'ipv6')) return true;
  return privateIPs.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
export function webTool(projectId: string, access: Access): FxAgentHostTool {
  return {
    name: 'fetch_url',
    description:
      'Fetch one HTTP(S) page as text (256 KiB maximum). No scripts, cookies or credentials. Internet access follows the selected mode; redirects are checked separately.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
    idempotent: true,
    writes: false,
    execute: async (input, ctx) => {
      let url = new URL(
        z
          .object({ url: z.string().max(4000) })
          .strict()
          .parse(input).url,
      );
      const context = access.context(projectId, ctx);
      for (let hop = 0; hop <= 4; hop++) {
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new AppError(400, 'web_url', 'Use an HTTP(S) URL without embedded credentials.');
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(hostname)
          ? [{ address: hostname, family: isIP(hostname) }]
          : await lookup(hostname, { all: true });
        if (!addresses.length) throw new AppError(400, 'web_dns', 'The hostname did not resolve.');
        const check = await access.authorize(
          { ...context, callId: `${context.callId}:${hop}` },
          {
            kind: 'web',
            title: hop ? 'Follow webpage redirect' : 'Read webpage',
            target: url.href,
            network: true,
            sensitive:
              addresses.some((a) => privateAddress(a.address)) ||
              !!url.search ||
              url.pathname.length > 200,
          },
        );
        check();
        const address = addresses[0]!;
        const response = await new Promise<{ status: number; location?: string; body: string }>(
          (resolve, reject) => {
            const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)]);
            const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
              url,
              {
                method: 'GET',
                signal,
                headers: {
                  accept: 'text/plain, text/html, application/json',
                  'accept-encoding': 'identity',
                },
                // Pin the evaluated address. Re-resolving after approval would permit DNS rebinding.
                lookup: ((_host: string, options: any, callback: any) =>
                  options.all
                    ? callback(null, [address])
                    : callback(null, address.address, address.family)) as any,
              },
              (res) => {
                const chunks: Buffer[] = [];
                let bytes = 0;
                res.on('data', (chunk) => {
                  bytes += chunk.length;
                  if (bytes > 256 * 1024) res.destroy(new Error('Page exceeds 256 KiB.'));
                  else chunks.push(chunk);
                });
                res.on('error', reject);
                res.on('end', () =>
                  resolve({
                    status: res.statusCode ?? 0,
                    location: res.headers.location,
                    body: Buffer.concat(chunks).toString('utf8'),
                  }),
                );
              },
            );
            request.on('error', reject);
            request.end();
          },
        );
        if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
          url = new URL(response.location, url);
          continue;
        }
        return { url: url.href, status: response.status, text: response.body };
      }
      throw new AppError(400, 'web_redirects', 'Too many redirects.');
    },
  };
}
