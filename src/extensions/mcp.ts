import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createMcpAdapter, type McpClient } from 'libfx/mcp';
import { z } from 'zod';
import { AppError, safeEndpoint } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { digest } from './skills.js';
export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  digest: string;
};
export type McpServer = {
  id: string;
  projectId: string;
  name: string;
  transport: 'http' | 'stdio' | 'agent-zero';
  remoteProject?: string;
  url?: string;
  command?: string;
  args: string[];
  hasCredential: boolean;
  enabled: boolean;
  tools: McpTool[];
  allowed: string[];
  verifiedAt?: string;
  serverVersion?: string;
};
export type McpCall = {
  id: string;
  projectId: string;
  serverId: string;
  tool: string;
  args: Record<string, unknown>;
  callKey: string;
  digest: string;
  toolDigest: string;
  scope: string;
  status: 'pending' | 'running' | 'unknown' | 'completed' | 'rejected' | 'resolved';
  createdAt: string;
  result?: string;
  resolution?: string;
};
export const mcpInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    transport: z.enum(['http', 'stdio', 'agent-zero']),
    remoteProject: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,100}$/)
      .optional(),
    url: z.string().max(500).optional(),
    command: z.string().max(2048).optional(),
    args: z.array(z.string().max(2048)).max(32).default([]),
    token: z.string().max(8192).optional(),
    acknowledgeHostExecution: z.boolean().default(false),
  })
  .strict();
const error = (code: string, message: string) => new AppError(409, code, message);
const companionSchema = z
  .object({
    protocol: z.literal('a0-slim-tools/1'),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    scopeId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export function companionDescriptor(tool: Pick<McpTool, 'inputSchema'>) {
  const raw = tool.inputSchema['x-a0-slim-companion'];
  if (raw === undefined) return undefined;
  const parsed = companionSchema.safeParse(raw);
  if (!parsed.success) throw error('companion_contract', 'Invalid companion identity.');
  return parsed.data;
}
export class McpConnections {
  private active = new Map<string, AbortController>();
  private activeScopes = new Set<string>();
  private scope(server: McpServer) {
    const companion = server.tools.map(companionDescriptor).find(Boolean);
    if (companion) return digest({ companionScope: companion.scopeId });
    return digest({
      transport: server.transport,
      url: server.url,
      remoteProject: server.remoteProject,
      command: server.command,
      args: server.args,
      cwd: server.transport === 'stdio' ? this.store.project(server.projectId).root : undefined,
    });
  }
  constructor(
    private store: Store,
    private vault: Vault,
  ) {
    for (const c of this.calls())
      if (c.status === 'running') this.store.record('mcp-call', { ...c, status: 'unknown' });
  }
  list(projectId: string) {
    this.store.project(projectId);
    return this.store.records<McpServer>('mcp').filter((s) => s.projectId === projectId);
  }
  get(projectId: string, id: string) {
    const s = this.list(projectId).find((s) => s.id === id);
    if (!s) throw new AppError(404, 'mcp_missing', 'MCP server not found in this project.');
    return s;
  }
  calls(projectId?: string) {
    return this.store
      .records<McpCall>('mcp-call')
      .filter((c) => !projectId || c.projectId === projectId);
  }
  async add(projectId: string, raw: unknown) {
    const input = mcpInput.parse(raw);
    this.store.project(projectId);
    if (this.list(projectId).length >= 20)
      throw error('mcp_limit', 'Add at most 20 servers per project.');
    if (
      input.transport === 'stdio' &&
      (!input.acknowledgeHostExecution || !input.command || !isAbsolute(input.command))
    )
      throw error(
        'host_permission',
        'A local server runs with your OS account. Review it and explicitly allow an absolute executable path.',
      );
    if (input.transport === 'stdio' && input.token)
      throw error('mcp_token', 'Bearer tokens are supported for HTTP connections only.');
    if (input.transport === 'agent-zero' && !input.token)
      throw error('bridge_token', 'Enter the Agent Zero MCP token in the protected token field.');
    if (input.transport !== 'stdio' && /\/mcp\/t-/.test(input.url ?? ''))
      throw error(
        'bridge_token_url',
        'Use the Agent Zero bridge preset with its base URL and separate token field. Do not paste a token-bearing URL.',
      );
    const server: McpServer = {
      id: randomUUID(),
      projectId,
      name: input.name,
      transport: input.transport,
      args: input.args,
      hasCredential: !!input.token,
      enabled: false,
      tools: [],
      allowed: [],
      ...(input.transport !== 'stdio'
        ? {
            url: safeEndpoint(input.url ?? ''),
            ...(input.transport === 'agent-zero' && input.remoteProject
              ? { remoteProject: input.remoteProject }
              : {}),
          }
        : { command: input.command }),
    };
    if (input.token) await this.vault.set(`mcp:${server.id}`, { token: input.token });
    this.store.record('mcp', server);
    return server;
  }
  private async connect(server: McpServer, signal: AbortSignal) {
    const client = new Client({ name: 'a0-slim', version: '0.1.0' });
    const secret = await this.vault.get<{ token: string }>(`mcp:${server.id}`);
    const endpoint =
      server.transport === 'agent-zero'
        ? `${server.url}/mcp/t-${encodeURIComponent(secret?.token ?? '')}${server.remoteProject ? `/p-${encodeURIComponent(server.remoteProject)}` : ''}/http`
        : server.url;
    const transport =
      server.transport !== 'stdio'
        ? new StreamableHTTPClientTransport(new URL(endpoint!), {
            requestInit: {
              ...(secret?.token && server.transport === 'http'
                ? { headers: { authorization: `Bearer ${secret.token}` } }
                : {}),
              redirect: 'error',
            },
            fetch: async (url, init) => {
              if (new URL(String(url)).origin !== new URL(server.url!).origin)
                throw error('mcp_origin', 'MCP request changed origin.');
              const response = await fetch(url, {
                ...init,
                redirect: 'error',
                signal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(20000),
                  ...(init?.signal ? [init.signal] : []),
                ]),
              });
              // Bound JSON and event streams before the SDK accumulates them.
              if (!response.body) return response;
              let bytes = 0;
              const bounded = response.body.pipeThrough(
                new TransformStream<Uint8Array, Uint8Array>({
                  transform(chunk, controller) {
                    bytes += chunk.byteLength;
                    if (bytes > 1024 * 1024) throw new Error('MCP response exceeds 1 MiB.');
                    controller.enqueue(chunk);
                  },
                }),
              );
              return new Response(bounded, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
              });
            },
            reconnectionOptions: {
              maxReconnectionDelay: 0,
              initialReconnectionDelay: 0,
              reconnectionDelayGrowFactor: 1,
              maxRetries: 0,
            },
          })
        : new StdioClientTransport({
            command: server.command!,
            args: server.args,
            cwd: this.store.project(server.projectId).root,
            env: {
              PATH: process.env.PATH ?? '/usr/bin:/bin',
              HOME: process.env.HOME ?? '',
              LANG: 'en_US.UTF-8',
            },
            stderr: 'ignore',
          });
    const abort = () => void client.close().catch(() => {});
    signal.addEventListener('abort', abort, { once: true });
    const close = async () => {
      signal.removeEventListener('abort', abort);
      await client.close().catch(() => {});
    };
    try {
      await client.connect(transport, { signal, timeout: 15000 });
      return { client, close };
    } catch {
      await close();
      throw error(
        'mcp_connect',
        'MCP connection failed. Check the address, credentials, and server. No credentials are included in diagnostics.',
      );
    }
  }
  private async catalog(client: Client, signal: AbortSignal) {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await client.listTools(cursor ? { cursor } : undefined, {
        signal,
        timeout: 15000,
      });
      for (const t of result.tools) {
        if (
          tools.length >= 64 ||
          tools.some((x) => x.name === t.name) ||
          t.name.length > 100 ||
          JSON.stringify(t.inputSchema).length > 16000
        )
          throw error('mcp_catalog', 'MCP catalog exceeds the supported bounds.');
        const item = {
          name: t.name,
          description: (t.description ?? 'MCP tool').slice(0, 4000),
          inputSchema: t.inputSchema,
        };
        tools.push({ ...item, digest: digest(item) });
      }
      cursor = result.nextCursor;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 16)
          throw error('mcp_catalog', 'MCP pagination did not finish.');
        seen.add(cursor);
      }
    } while (cursor);
    const companions = tools.map(companionDescriptor);
    if (
      companions.some(Boolean) &&
      (companions.some((c) => !c) || new Set(companions.map((c) => JSON.stringify(c))).size !== 1)
    )
      throw error('companion_contract', 'Companion catalog must share one scope and revision.');
    return tools;
  }
  async discover(projectId: string, id: string) {
    const server = this.get(projectId, id);
    if (this.active.has(id)) throw error('mcp_busy', 'This server is busy.');
    const controller = new AbortController();
    this.active.set(id, controller);
    try {
      const { client, close } = await this.connect(server, controller.signal);
      try {
        const tools = await this.catalog(client, controller.signal),
          current = this.get(projectId, id);
        const next = {
          ...current,
          tools,
          allowed: current.allowed.filter((n) =>
            tools.some(
              (t) =>
                t.name === n &&
                current.tools.some((old) => old.name === n && old.digest === t.digest),
            ),
          ),
          verifiedAt: new Date().toISOString(),
          serverVersion: JSON.stringify(client.getServerVersion() ?? {}),
        };
        this.store.record('mcp', next);
        return next;
      } finally {
        await close();
      }
    } finally {
      this.active.delete(id);
    }
  }
  configure(projectId: string, id: string, enabled: boolean, allowed: string[]) {
    const server = this.get(projectId, id);
    if (allowed.some((name) => !server.tools.some((t) => t.name === name)))
      throw error('mcp_permission', 'Discover and review this tool before allowing it.');
    this.store.record('mcp', { ...server, enabled, allowed: [...new Set(allowed)] });
    if (!enabled) this.active.get(id)?.abort();
    for (const c of this.calls(projectId))
      if (c.serverId === id && c.status === 'pending' && (!enabled || !allowed.includes(c.tool)))
        this.store.record('mcp-call', { ...c, status: 'rejected' });
  }
  stage(
    projectId: string,
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    callKey: string,
  ) {
    const server = this.get(projectId, serverId),
      entry = server.tools.find((t) => t.name === tool);
    if (!server.enabled || !server.allowed.includes(tool) || !entry)
      throw error('mcp_permission', 'This tool is not enabled for this project.');
    if (JSON.stringify(args).length > 32000)
      throw error('mcp_arguments', 'MCP arguments exceed 32 KiB.');
    const old = this.calls(projectId).find((c) => c.callKey === callKey);
    if (old) {
      if (
        digest({ serverId, tool, args }) !==
        digest({ serverId: old.serverId, tool: old.tool, args: old.args })
      )
        throw error('mcp_replay', 'Operation ID already used.');
      return old;
    }
    if (
      this.calls().some(
        (c) =>
          (c.serverId === serverId || c.scope === this.scope(server)) &&
          ['running', 'unknown'].includes(c.status),
      )
    )
      throw error(
        'mcp_unknown',
        'Resolve the unknown call before proposing another call to this server.',
      );
    if (this.calls(projectId).filter((c) => c.status === 'pending').length >= 100)
      throw error('mcp_queue', 'Review pending calls before staging more.');
    const call: McpCall = {
      id: randomUUID(),
      projectId,
      serverId,
      tool,
      args,
      callKey,
      toolDigest: entry.digest,
      scope: this.scope(server),
      digest: digest({ serverId, tool, args, toolDigest: entry.digest }),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.store.record('mcp-call', call);
    return call;
  }
  async approve(projectId: string, id: string, hash: string) {
    const call = this.calls(projectId).find((c) => c.id === id);
    if (!call || call.digest !== hash)
      throw error('mcp_approval', 'The reviewed action does not match.');
    if (call.status !== 'pending') return call;
    const server = this.get(projectId, call.serverId);
    if (!server.enabled || !server.allowed.includes(call.tool))
      throw error('mcp_permission', 'This tool was disabled.');
    if (
      this.active.has(server.id) ||
      this.activeScopes.has(this.scope(server)) ||
      this.calls().some(
        (c) =>
          (c.serverId === server.id || c.scope === this.scope(server)) &&
          ['unknown', 'running'].includes(c.status),
      )
    )
      throw error('mcp_busy', 'Resolve the existing call first.');
    const abort = new AbortController();
    this.active.set(server.id, abort);
    this.activeScopes.add(this.scope(server));
    let sent = false;
    try {
      const { client, close } = await this.connect(server, abort.signal);
      try {
        const tools = await this.catalog(client, abort.signal),
          tool = tools.find((t) => t.name === call.tool);
        if (tool?.digest !== call.toolDigest)
          throw error(
            'mcp_changed',
            'Tool description or schema changed. Discover and review it again.',
          );
        const current = this.get(projectId, server.id);
        if (!current.enabled || !current.allowed.includes(call.tool))
          throw error('mcp_permission', 'This tool was disabled.');
        const adapter = await createMcpAdapter({
          listTools: () => ({ tools: [tool] }),
          callTool: (params, _schema, options) =>
            client.callTool(
              {
                ...params,
                ...(companionDescriptor(tool)
                  ? {
                      _meta: {
                        'io.a0-slim/operation': {
                          id: call.id,
                          fingerprint: companionDescriptor(tool)!.fingerprint,
                        },
                      },
                    }
                  : {}),
              } as Parameters<Client['callTool']>[0],
              undefined,
              {
                ...options,
                timeout: 20000,
              },
            ),
        } as McpClient);
        // The durable intent precedes the only external tool invocation. Never retry an ambiguous result.
        this.store.record('mcp-call', { ...call, status: 'running' });
        sent = true;
        const result = await adapter.tools[0]!.execute(call.args, {
          signal: abort.signal,
          sessionId: 'human-approved',
          executionId: call.id,
        });
        const rendered = typeof result === 'string' ? result : JSON.stringify(result);
        if (rendered.length > 64000)
          throw error('mcp_output', 'MCP output exceeds the retained limit.');
        const done: McpCall = { ...call, status: 'completed', result: rendered };
        this.store.record('mcp-call', done);
        return done;
      } finally {
        await close();
      }
    } catch (e) {
      if (sent) {
        const unknown: McpCall = { ...call, status: 'unknown' };
        this.store.record('mcp-call', unknown);
        return unknown;
      }
      throw e;
    } finally {
      this.active.delete(server.id);
      this.activeScopes.delete(this.scope(server));
    }
  }
  resolve(projectId: string, id: string, action: 'reject' | 'resolve', resolution: string) {
    const call = this.calls(projectId).find((c) => c.id === id);
    if (!call) throw error('mcp_missing', 'Call not found.');
    if (action === 'reject' && call.status === 'pending')
      this.store.record('mcp-call', { ...call, status: 'rejected' });
    else if (action === 'resolve' && call.status === 'unknown' && resolution.trim().length >= 10)
      this.store.record('mcp-call', { ...call, status: 'resolved', resolution });
    else
      throw error(
        'mcp_state',
        'Review the call status and record how you checked the remote outcome.',
      );
  }
  async remove(projectId: string, id: string) {
    this.get(projectId, id);
    if (
      this.active.has(id) ||
      this.calls().some((c) => c.serverId === id && ['running', 'unknown'].includes(c.status))
    )
      throw error('mcp_busy', 'Resolve active or unknown calls before removing this server.');
    this.configure(projectId, id, false, []);
    await this.vault.remove(`mcp:${id}`);
    this.store.removeRecord('mcp', id);
  }
  async close() {
    for (const controller of this.active.values()) controller.abort();
  }
}
