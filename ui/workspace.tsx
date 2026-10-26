import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BookOpen,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Circle,
  Folder,
  FileText,
  Layers,
  Menu,
  MessageSquare,
  PanelRight,
  Plug,
  Plus,
  Settings2,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import type { Chat, Connection, Project } from '../src/domain.js';
import type { EnvironmentStatus } from '../src/execution/status.js';
import { Artifacts, type ArtifactSummary } from './artifacts.js';
import { api } from './api.js';
import { Connections } from './settings.js';
import { AgentConnections, AgentPermissions, type ACPState } from './agents.js';
import { Environments } from './environments.js';
import type { VercelReadiness } from './execution-choice.js';
import { ExtensionWorkspace, PluginHubView } from './extensions.js';
import { MemoryWorkspace } from './memory.js';
import { Markdown } from './markdown.js';
import { DelegatedTasks, type DelegationSummary } from './delegations.js';

type State = {
  acp: ACPState;
  projects: Project[];
  chats: Chat[];
  connections: Connection[];
  receipts: Record<string, any>[];
  artifacts: ArtifactSummary[];
  sandboxConfigured: boolean;
  modalConfigured: boolean;
  cloudConfigured: Record<string, boolean>;
  environments: EnvironmentStatus;
  vercelExecution: VercelReadiness;
  delegations: DelegationSummary[];
};
type Line = { cursor: number; event: Record<string, any> };
type View =
  | 'chat'
  | 'agents'
  | 'connections'
  | 'environments'
  | 'appearance'
  | 'extensions'
  | 'hub'
  | 'memory';
const empty: State = {
  vercelExecution: {
    available: false,
    reason: 'Save a Vercel connection first.',
    revision: 'legacy',
  },
  acp: { profiles: [], permissions: [], holds: [], connected: [] },
  projects: [],
  chats: [],
  connections: [],
  receipts: [],
  artifacts: [],
  sandboxConfigured: false,
  modalConfigured: false,
  cloudConfigured: {},
  environments: {},
  delegations: [],
};
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'symbol small' : 'symbol'}>
      <img className="dark-logo" src="/a0-symbol-dark.svg" alt="Agent Zero" />
      <img className="light-logo" src="/a0-symbol-light.svg" alt="Agent Zero" />
    </span>
  );
}
export function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="section-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}
export function App() {
  const [paired, setPaired] = useState<boolean | null>(null),
    [state, setState] = useState<State>(empty);
  const [view, setView] = useState<View>('chat'),
    [projectId, setProjectId] = useState(''),
    [connectionId, setConnectionId] = useState(''),
    [chatId, setChatId] = useState('');
  const [prompt, setPrompt] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [streamStatus, setStreamStatus] = useState('');
  const [lines, setLines] = useState<Line[]>([]),
    [inspector, setInspector] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [tab, setTab] = useState('activity');
  const [projectForm, setProjectForm] = useState(false),
    [theme, setTheme] = useState(() => localStorage.getItem('slim.theme') ?? 'graphite');
  const [accent, setAccent] = useState(() => localStorage.getItem('slim.accent') ?? 'sage'),
    [density, setDensity] = useState(() => localStorage.getItem('slim.density') ?? 'comfortable');
  const scroll = useRef<HTMLDivElement>(null),
    sendLock = useRef(false);
  const project = state.projects.find((p) => p.id === projectId),
    chat = state.chats.find((c) => c.id === chatId);
  const connection = state.connections.find((c) => c.id === (chat?.connectionId ?? connectionId));
  const external = chat ? chat.backend === 'acp' : connectionId.startsWith('acp:');
  const agent = state.acp.profiles.find(
    (p) => p.id === (chat?.connectionId ?? connectionId.slice(4)),
  );
  const running = chat?.status === 'running';
  const execution = chat ? (chat.execution ?? 'none') : (project?.execution ?? 'none');
  const vercelActivity =
    state.environments.vercel?.activity === 'working'
      ? 'working'
      : state.environments.vercel?.activity === 'unknown'
        ? 'needs review'
        : !project?.vercelGrant ||
            project.vercelGrant.revision !== state.vercelExecution.revision ||
            (chat && chat.executionRevision !== state.vercelExecution.revision)
          ? 'permission needed'
          : !state.vercelExecution.available
            ? 'check needed'
            : 'ready';
  const refresh = async () => {
    const next = await api<State>('/state');
    setState(next);
    setProjectId((id) => id || next.projects[0]?.id || '');
    setConnectionId(
      (id) =>
        id ||
        next.connections[0]?.id ||
        (next.acp.profiles.find((p) => !p.disabled)
          ? `acp:${next.acp.profiles.find((p) => !p.disabled)!.id}`
          : ''),
    );
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  useEffect(() => {
    void api<{ paired: boolean }>('/status')
      .then((result) => setPaired(result.paired))
      .catch((error) => setError(error.message));
  }, []);
  useEffect(() => {
    if (paired) void act(refresh);
  }, [paired]);
  useEffect(() => {
    if (!paired) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh().catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [paired]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.density = density;
    localStorage.setItem('slim.theme', theme);
    localStorage.setItem('slim.accent', accent);
    localStorage.setItem('slim.density', density);
  }, [theme, accent, density]);
  useEffect(() => {
    const url = new URL(location.href),
      result = url.searchParams.get('connection');
    if (result) {
      history.replaceState({}, '', '/');
      setView('connections');
      if (result === 'failed')
        setError('ChatGPT sign-in did not finish. Start a new attempt from Connections.');
    }
  }, []);
  useEffect(() => {
    setLines([]);
    setStreamStatus('');
    if (!chatId || !paired) return;
    const abort = new AbortController();
    let cursor = 0,
      failures = 0;
    async function read() {
      while (!abort.signal.aborted) {
        try {
          const response = await fetch(`/api/v1/chats/${chatId}/events?cursor=${cursor}`, {
            signal: abort.signal,
          });
          if (!response.ok || !response.body) throw new Error('Activity stream disconnected.');
          setStreamStatus('Live');
          failures = 0;
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let buffer = '';
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              buffer += decoder.decode(chunk.value, { stream: true });
              const parts = buffer.split('\n');
              buffer = parts.pop()!;
              for (const part of parts)
                if (part) {
                  const line = JSON.parse(part) as Line;
                  cursor = line.cursor;
                  setLines((previous) =>
                    previous.some((item) => item.cursor === line.cursor)
                      ? previous
                      : [...previous, line],
                  );
                  if (['turn_start', 'turn_end', 'tool_end'].includes(line.event.type))
                    void refresh().catch(() => {});
                }
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } catch {
          if (abort.signal.aborted) break;
        }
        if (++failures >= 5) {
          setStreamStatus('Disconnected · reopen this chat to reconnect');
          break;
        }
        setStreamStatus('Reconnecting…');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, failures * 1000);
          abort.signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    }
    void read();
    return () => abort.abort();
  }, [chatId, paired]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [lines.length]);
  useEffect(() => {
    if (!projectForm) return;
    const previous = document.activeElement as HTMLElement | null;
    const backgrounds = [...document.querySelectorAll<HTMLElement>('.sidebar,.main,.inspector')];
    backgrounds.forEach((element) => {
      element.inert = true;
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setProjectForm(false);
      }
      if (event.key === 'Tab') {
        const controls = [
          ...document.querySelectorAll<HTMLElement>('.modal button,.modal input'),
        ].filter((element) => !(element as HTMLButtonElement).disabled);
        if (event.shiftKey && document.activeElement === controls[0]) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      backgrounds.forEach((element) => {
        element.inert = false;
      });
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [projectForm]);
  const navigate = (next: View) => {
    setView(next);
    setMobileNav(false);
    setError('');
  };
  const newChat = () => {
    setChatId('');
    setLines([]);
    setPrompt('');
    navigate('chat');
  };
  const openChat = (id: string) => {
    setChatId(id);
    setPrompt('');
    navigate('chat');
  };
  const stopChat = (id: string) =>
    void act(async () => {
      await api(`/chats/${id}/cancel`, {});
      await refresh();
    });
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || sendLock.current || chat?.parentChatId) return;
    sendLock.current = true;
    setBusy(true);
    await act(async () => {
      let id = chatId;
      if (!id) {
        const created = await api<Chat>('/chats', {
          projectId,
          connectionId: external ? agent?.id : connectionId,
          ...(external ? { backend: 'acp' } : {}),
          title: prompt.trim().slice(0, 70),
        });
        id = created.id;
        setChatId(id);
      }
      await api(`/chats/${id}/${running ? 'steer' : 'messages'}`, {
        text: prompt,
        messageId: crypto.randomUUID(),
      });
      setPrompt('');
      await refresh();
    });
    sendLock.current = false;
    setBusy(false);
  }
  if (paired === null)
    return (
      <main className="pair">
        <Logo />
        <h1>Opening your workspace</h1>
        <p>{error || 'Connecting to the local service…'}</p>
      </main>
    );
  if (!paired)
    return (
      <main className="pair">
        <div className="brand">
          <Logo /> A0 SLIM <span className="pill">Local alpha</span>
        </div>
        <div className="pair-card">
          <h1>Connect this browser</h1>
          <p>
            Pair this browser with your local A0 SLIM service. Your terminal has a one-time code.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void act(async () => {
                await api('/pair', { code: data.get('code') });
                setPaired(true);
              });
            }}
          >
            <label>
              Pairing code
              <input
                name="code"
                autoComplete="off"
                required
                autoFocus
                placeholder="Paste the code from your terminal"
              />
            </label>
            <button className="primary" type="submit">
              Open workspace <ArrowUpRight size={16} />
            </button>
          </form>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small>
            <ShieldCheck size={14} /> One local service. One trusted OS user.
          </small>
        </div>
      </main>
    );
  return (
    <div className={`app ${inspector ? 'inspecting' : ''} ${mobileNav ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <span>
            A0 <b>SLIM</b>
          </span>
          <button
            className="icon mobile-only"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className="new-chat" onClick={newChat}>
          <Plus size={17} /> New chat <kbd>+</kbd>
        </button>
        <div className="nav-label">
          Workspace{' '}
          <button className="icon" aria-label="Add project" onClick={() => setProjectForm(true)}>
            <Plus size={15} />
          </button>
        </div>
        <label className="sr-only" htmlFor="project-select">
          Project
        </label>
        <select
          id="project-select"
          className="project-select"
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            newChat();
          }}
        >
          <option value="" disabled>
            Choose a project
          </option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {!state.projects.length && (
          <button className="nav-link" onClick={() => setProjectForm(true)}>
            <Folder size={16} /> Add your first folder
          </button>
        )}
        <div className="chat-list">
          {state.chats
            .filter((c) => c.projectId === projectId)
            .map((c) => (
              <button
                key={c.id}
                className={`nav-link ${c.id === chatId && view === 'chat' ? 'selected' : ''}`}
                onClick={() => openChat(c.id)}
              >
                <MessageSquare size={15} />
                <span>
                  {c.parentChatId ? '↳ ' : ''}
                  {c.title}
                </span>
                {c.status === 'running' && <span className="dot" />}
              </button>
            ))}
          {!state.chats.some((c) => c.projectId === projectId) && (
            <p className="nav-empty">No chats in this project yet.</p>
          )}
        </div>
        <nav className="nav-bottom">
          {(
            [
              ['connections', Plug, 'Connections'],
              ['agents', MessageSquare, 'Agents'],
              ['environments', Terminal, 'Environments'],
              ['extensions', Plug, 'Skills & MCP'],
              ['hub', Layers, 'Plugin Hub'],
              ['memory', BookOpen, 'Memory'],
              ['appearance', Settings2, 'Appearance'],
            ] as const
          ).map(([id, Icon, title]) => (
            <button
              key={id}
              className={`nav-link ${view === id ? 'selected' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={16} />
              {title}
            </button>
          ))}
          <div className="local-status">
            <span className="dot" /> Local service <span>α 0.1</span>
          </div>
        </nav>
      </aside>
      <main className="main">
        <header className="workbar">
          <button
            className="icon mobile-only"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={19} />
          </button>
          <span className="breadcrumb">
            {project?.name ?? 'Your workspace'} <span>/</span>
          </span>
          <strong>
            {view === 'chat'
              ? (chat?.title ?? 'New chat')
              : {
                  connections: 'Models & accounts',
                  agents: 'Agents',
                  environments: 'Environments',
                  appearance: 'Appearance',
                  extensions: 'Skills & MCP',
                  hub: 'Plugin Hub',
                  memory: 'Memory',
                }[view]}
          </strong>
          <div className="workbar-right">
            <button
              className="sandbox-status"
              onClick={() => navigate(external ? 'agents' : 'environments')}
              title={
                external
                  ? 'The external agent controls its execution environment and permissions.'
                  : execution === 'docker'
                    ? 'This chat uses disposable Docker containers for code calls. Open Environments for readiness and cleanup.'
                    : execution === 'vercel'
                      ? 'This chat runs code in temporary Vercel sandboxes. Docker is not used.'
                      : 'No sandbox is enabled for this chat. Open Environments to configure one.'
              }
            >
              <Terminal size={14} />
              {external
                ? `${agent?.name ?? 'Agent'} · ${state.acp.connected.includes(chatId) ? 'connected' : 'disconnected'}`
                : execution === 'vercel'
                  ? `Vercel · ${vercelActivity}`
                  : execution !== 'docker'
                    ? 'Sandbox off'
                    : state.environments.docker?.activity === 'working'
                      ? 'Docker · working'
                      : state.environments.docker?.activity === 'unknown'
                        ? 'Docker · needs review'
                        : 'Docker · no active sandbox'}
            </button>
            <span className="pill">Local alpha</span>
            <button
              className={`icon ${inspector ? 'selected' : ''}`}
              aria-label="Toggle project inspector"
              aria-pressed={inspector}
              onClick={() => setInspector(!inspector)}
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
            <button className="icon" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === 'chat' ? (
          <>
            <div ref={scroll} className="conversation">
              {chat?.parentChatId && (
                <p className="child-context">
                  <button className="text-link" onClick={() => openChat(chat.parentChatId!)}>
                    <ChevronLeft size={15} />{' '}
                    {state.chats.find((c) => c.id === chat.parentChatId)?.title ?? 'Parent chat'}
                  </button>
                  <span>Subordinate · read-only · level {chat.depth}</span>
                </p>
              )}
              {chat && !external && chat.capabilitiesVersion !== 2 && (
                <p className="permission-note">
                  This earlier chat retains its original tool set for recovery compatibility. Start
                  a new chat to use skills, MCP, and project memory.
                </p>
              )}
              {chat?.capabilitiesVersion === 2 && !chat.delegationVersion && (
                <p className="permission-note">
                  Start a new chat to use subordinate agents. This chat keeps its original tools.
                </p>
              )}
              {!lines.length ? (
                <div className="welcome">
                  <div className="welcome-symbol">
                    <Logo />
                  </div>
                  <h1>
                    What are we
                    <br />
                    working on?
                  </h1>
                  <p>Select a project and a model or agent, then describe the task.</p>
                  <div className="suggestions">
                    <button
                      onClick={() =>
                        setPrompt(
                          'Explore this project and explain how the main pieces fit together.',
                        )
                      }
                    >
                      <Folder size={19} />
                      <span>
                        Explore a project<small>Read files and explain the structure</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                    <button
                      onClick={() =>
                        setPrompt(
                          'Read the project documentation and identify the most useful next steps.',
                        )
                      }
                    >
                      <FileText size={19} />
                      <span>
                        Find the next step<small>Review documentation and next steps</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {(!project || (!connection && !agent)) && (
                    <div className="setup-line">
                      <span>{!project ? '01' : '02'}</span>
                      <button
                        onClick={() => (!project ? setProjectForm(true) : navigate('connections'))}
                      >
                        {!project ? 'Choose a project folder' : 'Add a model connection'}{' '}
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Transcript lines={lines} agentName={external ? agent?.name : undefined} />
              )}
              {chat && !external && (
                <DelegatedTasks
                  chat={chat}
                  chats={state.chats}
                  records={state.delegations}
                  open={openChat}
                  stop={stopChat}
                />
              )}
            </div>
            <div className="composer-wrap">
              {external && (
                <>
                  <AgentPermissions state={state.acp} chatId={chatId} act={act} refresh={refresh} />
                  {state.acp.holds.length > 0 && (
                    <p className="notice">
                      An external outcome needs review.{' '}
                      <button onClick={() => navigate('agents')}>Review in Agents</button>
                    </p>
                  )}
                </>
              )}
              {state.artifacts.some(
                (a) =>
                  a.projectId === projectId &&
                  ['pending', 'unknown', 'conflict'].includes(a.status),
              ) && (
                <button
                  className="artifact-banner"
                  onClick={() => {
                    setInspector(true);
                    setTab('artifacts');
                  }}
                >
                  <FileText size={16} />
                  <span>Artifacts ready for review</span>
                  <ArrowUpRight size={15} />
                </button>
              )}
              {chat?.lastStop && (
                <p className="notice" role="status">
                  {chat.lastStop}
                </p>
              )}
              {chat?.status === 'interrupted' && (
                <p className="notice">
                  This turn was interrupted. Saved activity is available; review it before sending a
                  new request.
                </p>
              )}
              {chat?.parentChatId ? (
                <div className="child-controls">
                  <p>This subordinate receives assignments from its parent chat.</p>
                  <button
                    onClick={() => {
                      openChat(chat.parentChatId!);
                      setPrompt(`Continue the existing subordinate with context_id ${chat.id}. `);
                    }}
                  >
                    Continue in parent <ArrowUpRight size={14} />
                  </button>
                  {running && (
                    <button onClick={() => stopChat(chat.id)}>
                      <Square size={14} /> Stop subordinate
                    </button>
                  )}
                </div>
              ) : (
                <form className="composer" onSubmit={send}>
                  <label className="sr-only" htmlFor="prompt">
                    {external ? `Message ${agent?.name ?? 'agent'}` : 'Message A0 SLIM'}
                  </label>
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    disabled={external && running}
                    placeholder={
                      external
                        ? running
                          ? 'Wait for the agent or use Stop…'
                          : `Message ${agent?.name ?? 'agent'}…`
                        : running
                          ? 'Redirect this task…'
                          : 'Message A0 SLIM…'
                    }
                    rows={2}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <label className="sr-only" htmlFor="model-select">
                      Model or agent
                    </label>
                    <select
                      id="model-select"
                      disabled={!!chatId}
                      value={chat ? `${external ? 'acp:' : ''}${chat.connectionId}` : connectionId}
                      onChange={(event) => setConnectionId(event.target.value)}
                    >
                      <option value="" disabled>
                        Choose a model or agent
                      </option>
                      {state.connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.model || 'Select model in Connections'}
                        </option>
                      ))}
                      {state.acp.profiles
                        .filter((p) => !p.disabled || p.id === chat?.connectionId)
                        .map((p) => (
                          <option key={p.id} value={`acp:${p.id}`}>
                            {p.name} · ACP{p.disabled ? ' · disabled' : ''}
                          </option>
                        ))}
                    </select>
                    <span className="boundary">
                      <ShieldCheck size={13} />{' '}
                      {external ? 'Agent permissions apply' : 'Review before applying'}
                    </span>
                    {running && !external && prompt.trim() && (
                      <button
                        type="submit"
                        disabled={busy}
                        title="Stop this turn and continue with your direction"
                      >
                        Redirect
                      </button>
                    )}
                    {running ? (
                      <button
                        className="send"
                        type="button"
                        onClick={() =>
                          void act(async () => {
                            await api(`/chats/${chatId}/cancel`, {});
                            await refresh();
                          })
                        }
                      >
                        <Square size={14} /> Stop
                      </button>
                    ) : (
                      <button
                        className="send"
                        type="submit"
                        aria-label="Send message"
                        disabled={
                          busy ||
                          !project ||
                          (external
                            ? !agent || agent.disabled || state.acp.holds.length > 0
                            : !connection?.model) ||
                          !prompt.trim()
                        }
                      >
                        <ArrowUp size={18} />
                      </button>
                    )}
                  </div>
                </form>
              )}
              <div className="composer-footer">
                <span>
                  {running
                    ? 'Working · closing the tab keeps this turn running'
                    : streamStatus || 'Ready'}
                </span>
                <span>
                  {external
                    ? 'Execution managed by the agent'
                    : execution === 'docker'
                      ? 'Docker starts per code call'
                      : execution === 'vercel'
                        ? vercelActivity === 'ready'
                          ? 'Vercel starts per code call'
                          : `Vercel · ${vercelActivity}`
                        : 'No sandbox enabled'}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="settings-content">
            {view === 'agents' && (
              <AgentConnections state={state.acp} refresh={refresh} act={act} />
            )}
            {view === 'connections' && (
              <Connections connections={state.connections} refresh={refresh} act={act} />
            )}
            {view === 'environments' && (
              <Environments
                configured={state.cloudConfigured}
                project={project}
                receipts={state.receipts}
                statuses={state.environments}
                vercelExecution={state.vercelExecution}
                refresh={refresh}
                act={act}
              />
            )}
            {view === 'appearance' && (
              <>
                <Heading title="Appearance">
                  Choose a theme, accent color, and spacing. Preferences are saved in this browser.
                </Heading>
                <div className="setting-row">
                  <div>
                    <h3>Appearance</h3>
                    <p>Choose a workspace that suits your light.</p>
                  </div>
                  <div className="segmented">
                    {['graphite', 'paper'].map((t) => (
                      <button
                        className={theme === t ? 'selected' : ''}
                        aria-pressed={theme === t}
                        key={t}
                        onClick={() => setTheme(t)}
                      >
                        {t === 'paper' ? 'Paper' : 'Graphite'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <h3>Accent</h3>
                    <p>Choose the color used for controls and selection.</p>
                  </div>
                  <div className="swatches">
                    {['sage', 'sky', 'clay'].map((a) => (
                      <button
                        aria-label={`${a} accent`}
                        aria-pressed={accent === a}
                        className={`swatch ${a} ${accent === a ? 'active' : ''}`}
                        key={a}
                        onClick={() => setAccent(a)}
                      >
                        {accent === a && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <h3>Density</h3>
                    <p>Space to breathe, or room for more.</p>
                  </div>
                  <div className="segmented">
                    {['comfortable', 'compact'].map((d) => (
                      <button
                        key={d}
                        className={density === d ? 'selected' : ''}
                        aria-pressed={density === d}
                        onClick={() => setDensity(d)}
                      >
                        {d === 'compact' ? 'Compact' : 'Comfortable'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="brand-credit">
                  <img src="/a0-horizontal-banner.svg" alt="Agent Zero" width="1500" height="500" />
                  <div>
                    <h3>Agent Zero</h3>
                    <p>A0 SLIM is an independent project inspired by Agent Zero.</p>
                    <a
                      href="https://github.com/agent0ai/agent-zero"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Explore Agent Zero <ArrowUpRight size={14} />
                    </a>
                  </div>
                </div>
              </>
            )}
            {view === 'extensions' && (
              <ExtensionWorkspace key={projectId} project={project} act={act} />
            )}
            {view === 'hub' && <PluginHubView project={project} act={act} />}
            {view === 'memory' && <MemoryWorkspace key={projectId} project={project} act={act} />}
          </div>
        )}
      </main>
      {inspector && (
        <aside className="inspector">
          <div className="inspector-tabs">
            {['activity', 'files', 'artifacts', 'memory'].map((t) => (
              <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>
                {t === 'activity'
                  ? 'Activity'
                  : t === 'files'
                    ? 'Files'
                    : t === 'memory'
                      ? 'Memory'
                      : 'Artifacts'}
              </button>
            ))}
            <button
              className="icon"
              aria-label="Close inspector"
              onClick={() => setInspector(false)}
            >
              <X size={17} />
            </button>
          </div>
          <div className="inspector-body">
            {tab === 'memory' ? (
              <MemoryWorkspace key={projectId} project={project} act={act} compact />
            ) : tab === 'artifacts' ? (
              <Artifacts
                items={state.artifacts.filter((a) => a.projectId === projectId)}
                refresh={refresh}
                act={act}
              />
            ) : tab === 'files' ? (
              <Files project={project} act={act} />
            ) : (
              <>
                <h3>{chat?.title ?? 'New chat'}</h3>
                <p>Current model, execution environment, and chat status.</p>
                <div className="detail">
                  <span>Model</span>
                  <span>{chat?.model || connection?.model || 'Not selected'}</span>
                </div>
                <div className="detail">
                  <span>Execution</span>
                  <span>
                    {execution === 'docker'
                      ? 'Local Docker'
                      : execution === 'vercel'
                        ? 'Vercel Sandbox'
                        : 'Off'}
                  </span>
                </div>
                <div className="detail">
                  <span>Files</span>
                  <span>Approval required</span>
                </div>
                <div className="detail">
                  <span>Chat</span>
                  <span>{chat?.status ?? 'Draft'}</span>
                </div>
                <div className="timeline">
                  {lines
                    .filter((l) => ['tool_start', 'tool_end', 'turn_end'].includes(l.event.type))
                    .map((l) => (
                      <div key={l.cursor}>
                        <Circle size={8} />
                        <span>
                          {l.event.type === 'tool_start'
                            ? `Tool · ${l.event.name}`
                            : l.event.type === 'tool_end'
                              ? l.event.isError
                                ? 'Tool returned an error'
                                : `${l.event.name} finished`
                              : `Turn ended · ${l.event.stopReason ?? 'unknown'}`}
                        </span>
                      </div>
                    ))}
                </div>
                <p className="fine">
                  File changes appear as reviewable artifacts. Shell commands and background
                  scheduling are not enabled.
                </p>
              </>
            )}
          </div>
        </aside>
      )}
      {projectForm && (
        <div className="modal-backdrop" onClick={() => setProjectForm(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon close"
              aria-label="Close project form"
              onClick={() => setProjectForm(false)}
            >
              <X size={18} />
            </button>
            <h2 id="project-title">Add a project</h2>
            <p>
              The agent can read text files inside this folder when you send a request. Choose a
              focused project folder.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act(async () => {
                  const p = await api<Project>('/projects', {
                    name: data.get('name'),
                    root: data.get('root'),
                  });
                  await refresh();
                  setProjectId(p.id);
                  setProjectForm(false);
                  newChat();
                });
              }}
            >
              <label>
                Project name
                <input name="name" required maxLength={80} autoFocus placeholder="Field notes" />
              </label>
              <label>
                Absolute folder path
                <input name="root" required placeholder="/Users/you/Projects/field-notes" />
              </label>
              <button className="primary" type="submit">
                Add project <ArrowUpRight size={16} />
              </button>
            </form>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Transcript({ lines, agentName }: { lines: Line[]; agentName?: string }) {
  const entries: Array<{ type: string; text: string; key: number }> = [];
  for (const { cursor, event } of lines) {
    if (event.type === 'turn_start')
      entries.push({
        type: 'user',
        text: typeof event.input === 'string' ? event.input : '',
        key: cursor,
      });
    if (event.type === 'text_delta') {
      const last = entries.at(-1);
      if (last?.type === 'assistant') last.text += event.delta;
      else entries.push({ type: 'assistant', text: event.delta, key: cursor });
    }
    if (event.type === 'tool_start')
      entries.push({
        type: 'tool',
        text: `${event.name === 'write_file' ? 'Drafting artifact' : event.name === 'list_dir' ? 'Inspecting folder' : event.name === 'read_file' ? 'Reading file' : event.name === 'run_javascript' ? 'Running Node.js' : event.name === 'call_subordinate' ? 'Delegating task' : event.name}${typeof event.input?.path === 'string' ? ` · ${event.input.path}` : event.name === 'call_subordinate' && event.input?.name ? ` · ${event.input.name}` : ''}`,
        key: cursor,
      });
    if (event.type === 'acp_plan')
      entries.push({
        type: 'tool',
        text: event.entries
          .map((e: { status: string; content: string }) => `${e.status}: ${e.content}`)
          .join('\n'),
        key: cursor,
      });
    if (event.type === 'acp_permission')
      entries.push({
        type: 'tool',
        text: `Permission decision: ${event.title} · ${event.optionId}`,
        key: cursor,
      });
    if (event.type === 'turn_end' && event.error)
      entries.push({ type: 'error', text: String(event.error), key: cursor });
  }
  return (
    <div className="transcript">
      {entries.map((entry) => (
        <div key={entry.key} className={`message ${entry.type}`}>
          {entry.type === 'assistant' && (
            <div className="assistant-label">
              {!agentName && <Logo small />} {agentName ?? 'A0 SLIM'}
            </div>
          )}
          {entry.type === 'tool' && <FileText size={14} />}
          <div className="message-text">
            {entry.type === 'assistant' ? <Markdown text={entry.text} /> : entry.text}
          </div>
        </div>
      ))}
    </div>
  );
}
function Files({
  project,
  act,
}: {
  project?: Project;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [path, setPath] = useState('.'),
    [entries, setEntries] = useState<Array<{ name: string; kind: string }>>([]),
    [preview, setPreview] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    setPath('.');
    setPreview(null);
  }, [project?.id]);
  useEffect(() => {
    const abort = new AbortController();
    if (project)
      void api(
        `/projects/${project.id}/files?path=${encodeURIComponent(path)}`,
        undefined,
        abort.signal,
      )
        .then((result) => setEntries(result.entries))
        .catch(() => setEntries([]));
    return () => abort.abort();
  }, [project?.id, path]);
  if (!project) return <p>Choose a project to explore its files.</p>;
  return (
    <>
      <h3>{project.name}</h3>
      <p className="file-path">{preview?.path ?? path}</p>
      {(path !== '.' || preview) && (
        <button
          className="text-link"
          onClick={() =>
            preview ? setPreview(null) : setPath(path.split('/').slice(0, -1).join('/') || '.')
          }
        >
          <ChevronLeft size={14} /> Back
        </button>
      )}
      {preview ? (
        <pre className="file-preview">{preview.text}</pre>
      ) : (
        entries.map((entry) => (
          <button
            className="file-entry"
            key={entry.name}
            onClick={() => {
              const next = path === '.' ? entry.name : `${path}/${entry.name}`;
              if (entry.kind === 'directory') setPath(next);
              else
                void act(async () => {
                  const result = await api(
                    `/projects/${project.id}/files?read=true&path=${encodeURIComponent(next)}`,
                  );
                  setPreview({ path: next, text: result.text });
                });
            }}
          >
            {entry.kind === 'directory' ? <Folder size={15} /> : <FileText size={15} />}
            <span>{entry.name}</span>
          </button>
        ))
      )}
    </>
  );
}
