import * as protocol from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { access, realpath, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable, Transform } from 'node:stream';
import { z } from 'zod';
import { AppError, type Chat } from '../domain.js';
import { Store } from '../storage/store.js';
import { readWorkspaceFile } from '../tools/files.js';

export const agentInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    command: z.string().min(1).max(2048),
    args: z
      .array(
        z
          .string()
          .max(2048)
          .refine((v) => !v.includes('\0')),
      )
      .max(32),
    acknowledgeHostAccess: z.literal(true),
    readProjectFiles: z.boolean().default(false),
  })
  .strict();
export type AgentProfile = z.infer<typeof agentInput> & { id: string; disabled: boolean };
export type AgentPermission = {
  id: string;
  chatId: string;
  title: string;
  detail: string;
  options: { optionId: string; name: string; kind: string }[];
};
export type AgentTurn = {
  id: string;
  chatId: string;
  inputHash: string;
  status: 'running' | 'complete' | 'unknown' | 'reviewed';
  resolution?: string;
  stopReason?: string;
};
type Event = { id: string; cursor: number; type: string; [key: string]: unknown };
type Peer = {
  child: ChildProcessWithoutNullStreams;
  connection: protocol.ClientConnection;
  sessionId?: string;
  loading: boolean;
};
type Work = {
  stopped: boolean;
  sent: boolean;
  peer?: Peer;
  done: Promise<void>;
  bytes: number;
  updates: number;
  turnId: string;
};
const error = (code: string, message: string) => new AppError(409, code, message);
async function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(error('acp_timeout', 'The agent did not respond in time.')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/** ACP is an external runtime. No provider keys, native tools or MCP grants cross this boundary. */
export class ACPClient {
  private peers = new Map<string, Peer>();
  private active = new Map<string, Work>();
  private listeners = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();
  private permissions = new Map<
    string,
    { value: AgentPermission; resolve: (value: protocol.RequestPermissionResponse) => void }
  >();
  private closing = false;
  constructor(
    private store: Store,
    private stopTimeout = 5000,
  ) {
    for (const permission of this.store.records<{ id: string; status: string }>('acp-permission')) {
      if (permission.status === 'pending')
        this.store.record('acp-permission', { ...permission, status: 'cancelled' });
    }
    for (const turn of this.turns())
      if (turn.status === 'running') {
        this.store.record('acp-turn', { ...turn, status: 'unknown' });
        this.status(
          turn.chatId,
          'interrupted',
          'Agent connection interrupted. Review the external outcome before continuing.',
        );
        this.emit(turn.chatId, {
          type: 'turn_end',
          stopReason: 'unknown',
          error: 'External outcome unknown.',
        });
      }
  }
  profiles() {
    return this.store.records<AgentProfile>('acp-profile');
  }
  turns() {
    return this.store.records<AgentTurn>('acp-turn');
  }
  pending() {
    return [...this.permissions.values()].map((p) => p.value);
  }
  state() {
    return {
      profiles: this.profiles(),
      permissions: this.pending(),
      holds: this.turns().filter((t) => t.status === 'unknown'),
      connected: [...this.peers]
        .filter(([id, peer]) => !id.startsWith('check:') && !peer.loading && !!peer.sessionId)
        .map(([id]) => id),
    };
  }
  profile(id: string) {
    const profile = this.profiles().find((p) => p.id === id);
    if (!profile || profile.disabled)
      throw error('acp_unavailable', 'Enable this agent connection before continuing.');
    return profile;
  }
  async add(input: unknown) {
    const value = agentInput.parse(input);
    if (!isAbsolute(value.command) || value.command.includes('\0'))
      throw error('acp_command', 'Choose an absolute executable path.');
    await access(value.command, constants.X_OK);
    const profile: AgentProfile = {
      ...value,
      command: await realpath(value.command),
      id: randomUUID(),
      disabled: false,
    };
    this.store.record('acp-profile', profile);
    return profile;
  }
  async disable(id: string, disabled: boolean) {
    const profile = this.profiles().find((p) => p.id === id);
    if (!profile) throw error('acp_missing', 'Agent connection not found.');
    // Configurations are immutable. Disable blocks new work and stops owned sessions.
    this.store.record('acp-profile', { ...profile, disabled });
    if (disabled)
      for (const chat of this.store
        .chats()
        .filter((c) => c.backend === 'acp' && c.connectionId === id)) {
        await this.cancel(chat.id).catch(() => {});
        this.drop(chat.id);
      }
  }
  private status(id: string, status: Chat['status'], lastStop?: string) {
    this.store.saveChat({ ...this.store.chat(id), status, lastStop });
  }
  private emit(chatId: string, value: Record<string, unknown>) {
    const cursor = Number(this.store.meta(`acp-cursor:${chatId}`) ?? 0) + 1;
    const event = { ...value, id: String(cursor), cursor } as Event;
    this.store.db.transaction(() => {
      this.store.record(`acp-events:${chatId}`, event);
      this.store.setMeta(`acp-cursor:${chatId}`, String(cursor));
    })();
    const bytes = new TextEncoder().encode(JSON.stringify(event) + '\n');
    for (const reader of this.listeners.get(chatId) ?? []) {
      // A slow/hidden browser can reconnect from the journal without growing server memory.
      if ((reader.desiredSize ?? 0) < -128) {
        reader.close();
        this.listeners.get(chatId)?.delete(reader);
      } else reader.enqueue(bytes);
    }
  }
  stream(id: string, cursor: number) {
    this.store.chat(id);
    let controller: ReadableStreamDefaultController<Uint8Array>;
    return new ReadableStream<Uint8Array>({
      start: (c) => {
        controller = c;
        for (const event of this.store.records<Event>(`acp-events:${id}`).reverse())
          if (event.cursor > cursor)
            c.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        const set = this.listeners.get(id) ?? new Set();
        set.add(c);
        this.listeners.set(id, set);
      },
      cancel: () => {
        this.listeners.get(id)?.delete(controller);
      },
    });
  }
  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.connection.close();
    peer.child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (peer.child.exitCode === null && peer.child.signalCode === null)
        peer.child.kill('SIGKILL');
    }, 1000);
    timer.unref();
  }
  private async connect(id: string, profile: AgentProfile, cwd: string) {
    if (this.closing || this.peers.size >= 8)
      throw error('acp_limit', 'Disable an unused connection in Agents before opening another.');
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SYSTEMROOT'])
      if (process.env[key]) env[key] = process.env[key];
    const child = spawn(profile.command, profile.args, { cwd, env, shell: false, stdio: 'pipe' });
    child.stderr.resume(); // Never expose credential-bearing agent diagnostics through the API.
    let frame = Buffer.alloc(0);
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        let offset = 0;
        while (offset < chunk.length) {
          const newline = chunk.indexOf(10, offset);
          const end = newline < 0 ? chunk.length : newline;
          if (frame.length + end - offset > 1024 * 1024) {
            done(new Error('ACP frame too large'));
            return;
          }
          frame = Buffer.concat([frame, chunk.subarray(offset, end)]);
          if (newline >= 0) {
            try {
              const value = JSON.parse(frame.toString('utf8'));
              if (!value || Array.isArray(value) || value.jsonrpc !== '2.0')
                throw new Error('Invalid RPC');
            } catch {
              done(new Error('Invalid ACP frame'));
              return;
            }
            this.push(frame);
            this.push('\n');
            frame = Buffer.alloc(0);
          }
          offset = end + 1;
        }
        done();
      },
      flush(done) {
        done(frame.length ? new Error('Incomplete ACP frame') : undefined);
      },
    });
    const peer = { child, loading: true } as Peer;
    const client = protocol
      .client({ name: 'a0-slim' })
      .onNotification(protocol.methods.client.session.update, ({ params }) => {
        if (peer.loading || params.sessionId !== peer.sessionId) return;
        const work = this.active.get(id);
        if (!work || work.stopped) return;
        work.bytes += Buffer.byteLength(JSON.stringify(params));
        if (work.bytes > 2 * 1024 * 1024 || ++work.updates > 10_000) {
          void this.cancel(id).catch(() => {});
          return;
        }
        const update = params.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
          this.emit(id, { type: 'text_delta', delta: update.content.text });
        else if (update.sessionUpdate === 'tool_call')
          this.emit(id, { type: 'tool_start', name: update.title, toolCallId: update.toolCallId });
        else if (update.sessionUpdate === 'tool_call_update')
          this.emit(id, {
            type: 'tool_end',
            name: update.title ?? update.toolCallId,
            status: update.status,
            isError: update.status === 'failed',
          });
        else if (update.sessionUpdate === 'plan')
          this.emit(id, { type: 'acp_plan', entries: update.entries });
      })
      .onRequest(protocol.methods.client.session.requestPermission, ({ params }) => {
        const work = this.active.get(id);
        if (!work || work.stopped || peer.loading || params.sessionId !== peer.sessionId)
          return { outcome: { outcome: 'cancelled' as const } };
        if (this.permissions.size >= 32) return { outcome: { outcome: 'cancelled' as const } };
        const detail = JSON.stringify(params.toolCall, null, 2);
        if (
          Buffer.byteLength(detail) > 32000 ||
          new Set(params.options.map((o) => o.optionId)).size !== params.options.length
        )
          return { outcome: { outcome: 'cancelled' as const } };
        const value: AgentPermission = {
          id: randomUUID(),
          chatId: id,
          title: (params.toolCall.title ?? 'Agent tool call').slice(0, 2000),
          detail,
          options: params.options
            .filter((o) => ['allow_once', 'reject_once'].includes(o.kind))
            .slice(0, 8),
        };
        return new Promise<protocol.RequestPermissionResponse>((resolve) => {
          const record = {
            ...value,
            sessionId: peer.sessionId,
            turnId: work.turnId,
            digest: createHash('sha256').update(JSON.stringify(params)).digest('hex'),
          };
          this.store.record('acp-permission', { ...record, status: 'pending' });
          this.permissions.set(value.id, {
            value,
            resolve: (result) => {
              this.store.record('acp-permission', {
                ...record,
                status: result.outcome.outcome,
                outcome: result.outcome,
              });
              resolve(result);
            },
          });
        });
      })
      .onRequest(protocol.methods.client.fs.readTextFile, async ({ params }) => {
        const work = this.active.get(id);
        if (
          !profile.readProjectFiles ||
          !work ||
          work.stopped ||
          peer.loading ||
          params.sessionId !== peer.sessionId ||
          !isAbsolute(params.path)
        )
          throw new Error('File access denied');
        const content = await readWorkspaceFile(cwd, relative(cwd, params.path));
        const start = Math.max(0, (params.line ?? 1) - 1);
        return {
          content: content
            .split('\n')
            .slice(start, params.limit ? start + params.limit : undefined)
            .join('\n'),
        };
      });
    peer.connection = client.connect(
      protocol.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout.pipe(bounded)) as ReadableStream<Uint8Array>,
      ),
    );
    this.peers.set(id, peer);
    child.on('error', () => peer.connection.close());
    child.stdin.on('error', () => peer.connection.close());
    child.on('exit', () => peer.connection.close());
    void peer.connection.closed.then(() => {
      if (this.peers.get(id) === peer) this.drop(id);
      if (this.active.get(id)?.peer === peer) this.cancelPermissions(id);
    });
    try {
      const info = await deadline(
        peer.connection.agent.request(protocol.methods.agent.initialize, {
          protocolVersion: protocol.PROTOCOL_VERSION,
          clientInfo: { name: 'a0-slim', version: '0.1.0-alpha.1' },
          clientCapabilities: {
            fs: { readTextFile: profile.readProjectFiles, writeTextFile: false },
            terminal: false,
          },
        }),
        10_000,
      );
      if (info.protocolVersion !== protocol.PROTOCOL_VERSION)
        throw error('acp_version', 'This agent uses an unsupported ACP protocol version.');
      return { peer, info };
    } catch {
      this.drop(id);
      throw error(
        'acp_connect',
        'ACP connection failed. Check the executable, agent sign-in and instance settings.',
      );
    }
  }
  async check(profileId: string) {
    const profile = this.profile(profileId);
    const id = `check:${randomUUID()}`;
    const dir = await mkdtemp(join(tmpdir(), 'a0-slim-acp-check-'));
    try {
      const { info } = await this.connect(id, profile, dir);
      return {
        protocolVersion: info.protocolVersion,
        agentInfo: info.agentInfo,
        agentCapabilities: info.agentCapabilities,
        checkedAt: new Date().toISOString(),
        scope: 'Initialization only; no session or prompt sent.',
      };
    } finally {
      this.drop(id);
      await rm(dir, { recursive: true, force: true });
    }
  }
  private async session(chat: Chat, work: Work) {
    const existing = this.peers.get(chat.id);
    if (existing?.sessionId) return existing;
    const root = this.store.project(chat.projectId).root;
    if ((await realpath(root)) !== root)
      throw error('acp_project', 'The project folder changed. Select it again.');
    if (work.stopped || this.closing) throw error('acp_stopped', 'Stopped before connecting.');
    const { peer, info } = await this.connect(chat.id, this.profile(chat.connectionId), root);
    work.peer = peer;
    if (work.stopped || this.closing) throw error('acp_stopped', 'Stopped before sending.');
    if (chat.sessionId) {
      if (!info.agentCapabilities?.loadSession)
        throw error(
          'acp_load',
          'This agent cannot reload sessions. Start a new chat; saved activity remains available.',
        );
      peer.sessionId = chat.sessionId;
      await deadline(
        peer.connection.agent.request(protocol.methods.agent.session.load, {
          sessionId: chat.sessionId,
          cwd: root,
          mcpServers: [],
        }),
        15_000,
      );
    } else {
      const created = await deadline(
        peer.connection.agent.request(protocol.methods.agent.session.new, {
          cwd: root,
          mcpServers: [],
        }),
        15_000,
      );
      peer.sessionId = created.sessionId;
      this.store.saveChat({ ...this.store.chat(chat.id), sessionId: created.sessionId });
    }
    peer.loading = false;
    return peer;
  }
  prompt(chatId: string, text: string, messageId: string) {
    const chat = this.store.chat(chatId);
    this.profile(chat.connectionId);
    const inputHash = createHash('sha256').update(text).digest('hex');
    const old = this.turns().find((t) => t.id === messageId);
    if (old) {
      if (old.chatId !== chatId || old.inputHash !== inputHash)
        throw error('acp_duplicate', 'This message ID belongs to another request.');
      return { accepted: true, duplicate: true };
    }
    // Duplicate profiles can point to the same external runtime. Hold all ACP admission conservatively.
    if (this.turns().some((t) => t.status === 'unknown'))
      throw error(
        'acp_unknown',
        'An external agent outcome is unknown. Review it before sending another ACP task.',
      );
    if (this.active.has(chatId) || this.closing)
      throw error('acp_busy', 'Wait for the current task to finish stopping.');
    const turn: AgentTurn = { id: messageId, chatId, inputHash, status: 'running' };
    this.store.record('acp-turn', turn);
    this.status(chatId, 'running');
    this.emit(chatId, { type: 'turn_start', input: text, messageId });
    const work: Work = {
      stopped: false,
      sent: false,
      bytes: 0,
      updates: 0,
      turnId: messageId,
      done: Promise.resolve(),
    };
    this.active.set(chatId, work);
    work.done = this.run(chat, text, turn, work);
    return { accepted: true };
  }
  private async run(chat: Chat, text: string, turn: AgentTurn, work: Work) {
    try {
      const peer = await this.session(chat, work);
      work.peer = peer;
      if (work.stopped || this.closing) throw error('acp_stopped', 'Stopped before sending.');
      work.sent = true;
      const result = await deadline(
        peer.connection.agent.request(protocol.methods.agent.session.prompt, {
          sessionId: peer.sessionId!,
          prompt: [{ type: 'text', text }],
        }),
        10 * 60_000,
      );
      this.store.record('acp-turn', { ...turn, status: 'complete', stopReason: result.stopReason });
      this.status(
        chat.id,
        'idle',
        result.stopReason === 'end_turn' ? undefined : `Agent stopped: ${result.stopReason}`,
      );
      this.emit(chat.id, { type: 'turn_end', stopReason: result.stopReason });
    } catch {
      const unknown = work.sent;
      work.stopped = true;
      this.cancelPermissions(chat.id);
      this.store.record('acp-turn', {
        ...turn,
        status: unknown ? 'unknown' : 'complete',
        stopReason: unknown ? 'unknown' : 'not_sent',
      });
      this.status(
        chat.id,
        unknown ? 'interrupted' : 'idle',
        unknown
          ? 'External outcome unknown. Check the agent before continuing.'
          : 'No prompt was sent. Check the agent connection or start a new chat if it cannot reload this session.',
      );
      this.emit(chat.id, {
        type: 'turn_end',
        stopReason: unknown ? 'unknown' : 'not_sent',
        error: 'The agent turn did not complete.',
      });
      if (unknown && work.peer?.sessionId)
        await deadline(
          work.peer.connection.agent.notify(protocol.methods.agent.session.cancel, {
            sessionId: work.peer.sessionId,
          }),
          250,
        ).catch(() => {});
      this.drop(chat.id);
    } finally {
      this.cancelPermissions(chat.id);
      this.active.delete(chat.id);
    }
  }
  private cancelPermissions(chatId: string) {
    for (const [id, p] of this.permissions)
      if (p.value.chatId === chatId) {
        this.permissions.delete(id);
        p.resolve({ outcome: { outcome: 'cancelled' } });
      }
  }
  decide(id: string, optionId: string) {
    const pending = this.permissions.get(id);
    if (!pending || !pending.value.options.some((o) => o.optionId === optionId))
      throw error('acp_permission', 'This permission is no longer available.');
    this.permissions.delete(id);
    this.emit(pending.value.chatId, {
      type: 'acp_permission',
      title: pending.value.title,
      optionId,
    });
    pending.resolve({ outcome: { outcome: 'selected', optionId } });
  }
  async cancel(chatId: string) {
    const work = this.active.get(chatId);
    if (!work) return;
    work.stopped = true;
    this.cancelPermissions(chatId);
    const peer = this.peers.get(chatId);
    if (work.sent && peer?.sessionId)
      void peer.connection.agent
        .notify(protocol.methods.agent.session.cancel, { sessionId: peer.sessionId })
        .catch(() => {});
    else this.drop(chatId);
    try {
      await deadline(work.done, this.stopTimeout);
    } catch {
      this.drop(chatId);
      await work.done;
    }
    if (this.turns().some((t) => t.chatId === chatId && t.status === 'unknown'))
      throw error(
        'acp_unknown',
        'Stop was not confirmed by the agent. Review its external outcome.',
      );
  }
  review(id: string, resolution: string) {
    const turn = this.turns().find((t) => t.id === id);
    if (!turn || turn.status !== 'unknown' || this.active.has(turn.chatId))
      throw error('acp_review', 'This outcome is not ready for review.');
    this.store.record('acp-turn', { ...turn, status: 'reviewed', resolution });
    this.status(
      turn.chatId,
      'idle',
      'External outcome reviewed. The previous request will not be resent.',
    );
  }
  resume() {
    throw error(
      'acp_resume',
      'ACP never resends an interrupted request. Review unknown outcomes, then send a new message.',
    );
  }
  steer() {
    throw error(
      'acp_steer',
      'Stop the external agent and wait for its response before sending another message.',
    );
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.active.keys()].map((id) => this.cancel(id)));
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const readers of this.listeners.values()) for (const c of readers) c.close();
    this.listeners.clear();
  }
}
