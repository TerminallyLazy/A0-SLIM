import { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { Project } from '../src/domain.js';
import type { Skill } from '../src/extensions/skills.js';
import type { McpServer, McpCall } from '../src/extensions/mcp.js';
import type { HubCatalog, HubEntry } from '../src/extensions/hub.js';
import { api } from './api.js';
import { Heading } from './workspace.js';
export type Act = (fn: () => Promise<unknown>) => Promise<void>;
export const downloadText = (name: string, text: string, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const sample =
  '---\nname: deliberate-work\ndescription: Inspect, act, and verify project changes with a clear evidence trail.\n---\nRead the relevant project files before changing anything. Break substantial work into a short plan. Use the available tools, check the result, and distinguish completed actions from proposals awaiting approval. Save useful, attributable findings only when project memory writes are enabled. Never claim a check ran unless a tool result supports it.\n';
export function ExtensionWorkspace({ project, act }: { project?: Project; act: Act }) {
  const [data, setData] = useState<{ skills: Skill[]; servers: McpServer[]; calls: McpCall[] }>({
      skills: [],
      servers: [],
      calls: [],
    }),
    [section, setSection] = useState('skills'),
    [markdown, setMarkdown] = useState(''),
    [source, setSource] = useState('User import'),
    [editing, setEditing] = useState<string>(),
    [transport, setTransport] = useState('http'),
    [hostAck, setHostAck] = useState(false),
    [busy, setBusy] = useState(false);
  const base = `/projects/${project?.id}`;
  const refresh = async () => {
    if (project) setData(await api(`${base}/extensions`));
  };
  useEffect(() => {
    setData({ skills: [], servers: [], calls: [] });
    setMarkdown('');
    setEditing(undefined);
    void act(refresh);
  }, [project?.id]);
  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void act(async () => {
      try {
        await fn();
        await refresh();
      } finally {
        setBusy(false);
      }
    });
  };
  const importSkill = async () => {
    await api(`${base}/skills`, { markdown, source, ...(editing ? { id: editing } : {}) });
    setMarkdown('');
    setEditing(undefined);
  };
  if (!project)
    return (
      <Heading title="Choose a project">Skills and tool permissions belong to a project.</Heading>
    );
  return (
    <>
      <Heading title="Skills & MCP">
        Manage project skills and MCP connections. Enabled capabilities are available in new chats.
      </Heading>
      <div className="feature-tabs" role="tablist" aria-label="Extension categories">
        {[
          ['skills', 'Skills', BookOpen],
          ['mcp', 'MCP servers', Plug],
          [
            'calls',
            `Approvals · ${data.calls.filter((c) => c.status === 'pending' || c.status === 'unknown').length}`,
            ShieldCheck,
          ],
        ].map(([id, label, Icon]) => (
          <button
            key={id as string}
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id as string)}
            className={section === id ? 'selected' : ''}
          >
            {Icon && typeof Icon !== 'string' && <Icon size={16} />} {label as string}
          </button>
        ))}
      </div>
      {section === 'skills' && (
        <>
          <div className="feature-intro">
            <span className="pill">{data.skills.filter((s) => s.enabled).length} enabled</span>
            <p>
              Import a SKILL.md, review its instructions, then enable it. The agent sees a short
              catalog and loads relevant skills during a task. Scripts and resources are not
              imported.
            </p>
          </div>
          <div className="extension-grid">
            <section className="feature-panel">
              <div className="panel-title">
                <h2>Project skills</h2>
                <BookOpen size={18} />
              </div>
              {!data.skills.length && (
                <div className="empty-feature">
                  <BookOpen size={28} />
                  <h3>No skills imported</h3>
                  <p>Add your own portable instructions, or begin with a reviewed Slim example.</p>
                  <button
                    onClick={() => {
                      setMarkdown(sample);
                      setSource('A0 SLIM bundled example');
                      setEditing(undefined);
                    }}
                  >
                    Review starter skill
                  </button>
                </div>
              )}
              {data.skills.map((skill) => (
                <article className="feature-item" key={skill.id}>
                  <div className="panel-title">
                    <h3>{skill.name}</h3>
                    <span className={`pill ${skill.enabled ? 'positive' : ''}`}>
                      {skill.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p>{skill.description}</p>
                  <small>
                    Revision {skill.current.digest.slice(0, 12)} ·{' '}
                    {new Date(skill.current.importedAt).toLocaleDateString()}
                  </small>
                  <details>
                    <summary>Review instructions & source</summary>
                    <p className="wrap">{skill.current.source}</p>
                    <pre>{skill.current.markdown}</pre>
                  </details>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          api(`${base}/skills/${skill.id}`, {
                            action: skill.enabled ? 'disable' : 'enable',
                          }),
                        )
                      }
                    >
                      {skill.enabled ? 'Disable' : 'Enable skill'}
                    </button>
                    <button
                      onClick={() => {
                        setMarkdown(skill.current.markdown);
                        setSource(skill.current.source);
                        setEditing(skill.id);
                      }}
                    >
                      Edit
                    </button>
                    <button onClick={() => downloadText('SKILL.md', skill.current.markdown)}>
                      Export
                    </button>
                    {skill.previous && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() => api(`${base}/skills/${skill.id}`, { action: 'rollback' }))
                        }
                      >
                        Roll back
                      </button>
                    )}
                    <button
                      className="icon"
                      aria-label={`Delete ${skill.name}`}
                      disabled={busy}
                      onClick={() =>
                        run(() => api(`${base}/skills/${skill.id}`, { action: 'delete' }))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </section>
            <section className="feature-panel">
              <h2>{editing ? 'Update skill' : 'Import a skill'}</h2>
              <p>
                Updates start disabled so you can review the new revision. One previous revision is
                kept for rollback.
              </p>
              <label>
                Choose SKILL.md
                <input
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void act(async () => {
                        if (file.size > 32000)
                          throw new Error('Skill must be at most 32,000 bytes.');
                        setMarkdown(await file.text());
                        setSource(file.name);
                        setEditing(undefined);
                      });
                    e.target.value = '';
                  }}
                />
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const path = String(new FormData(e.currentTarget).get('path'));
                  run(async () => {
                    const preview = await api(`${base}/skills/preview`, { path });
                    setMarkdown(preview.markdown);
                    setSource(preview.source);
                    setEditing(undefined);
                  });
                }}
              >
                <label>
                  Or load from this project
                  <input name="path" placeholder="skills/my-skill/SKILL.md" required />
                </label>
                <button disabled={busy}>Load for review</button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  run(importSkill);
                }}
              >
                <label>
                  SKILL.md contents
                  <textarea
                    rows={12}
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    required
                    maxLength={32000}
                    placeholder={
                      '---\nname: my-skill\ndescription: When to use these instructions.\n---\nYour instructions…'
                    }
                  />
                </label>
                <label>
                  Source / provenance
                  <input
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    required
                    maxLength={500}
                  />
                </label>
                <div className="permission-note">
                  <ShieldCheck size={16} />
                  <span>
                    Instruction permission only. Enabling a skill grants no host execution, network
                    access, or additional tools.
                  </span>
                </div>
                <button className="primary" disabled={busy || !markdown}>
                  <Plus size={16} />
                  {editing ? 'Save new revision' : 'Import disabled'}
                </button>
              </form>
            </section>
          </div>
        </>
      )}
      {section === 'mcp' && (
        <>
          <div className="feature-intro">
            <span className="pill">Explicit tool permissions</span>
            <p>
              Discover a server’s tools, select what this project may use, and enable the
              connection. Every call still needs approval of its exact arguments.
            </p>
          </div>
          <div className="extension-grid">
            <section className="feature-panel">
              <h2>MCP servers</h2>
              {!data.servers.length && (
                <div className="empty-feature">
                  <Plug size={28} />
                  <h3>No MCP servers connected</h3>
                  <p>
                    Connect a Streamable HTTP endpoint or an installed local stdio server. Remote
                    sign-in flows and MCP Apps are not supported yet.
                  </p>
                </div>
              )}
              {data.servers.map((server) => (
                <article className="feature-item" key={server.id}>
                  <div className="panel-title">
                    <h3>{server.name}</h3>
                    <span className="pill">{server.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <p className="wrap">
                    {server.transport !== 'stdio'
                      ? server.url
                      : `${server.command} ${server.args.join(' ')}`}
                  </p>
                  <small>
                    {server.transport === 'stdio' ? 'Full-trust host process' : 'HTTP connection'} ·{' '}
                    {server.hasCredential ? 'Credential saved' : 'No credential'}
                    {server.verifiedAt
                      ? ` · Discovered ${new Date(server.verifiedAt).toLocaleString()}`
                      : ''}
                  </small>
                  <div className="button-row">
                    <button
                      disabled={busy}
                      onClick={() => run(() => api(`${base}/mcp/${server.id}/discover`, {}))}
                    >
                      <RefreshCw size={14} />
                      {server.transport === 'stdio' ? 'Start & discover' : 'Discover tools'}
                    </button>
                    <button
                      disabled={busy || !server.verifiedAt}
                      onClick={() =>
                        run(() =>
                          api(`${base}/mcp/${server.id}/configure`, {
                            enabled: !server.enabled,
                            allowed: server.allowed,
                          }),
                        )
                      }
                    >
                      {server.enabled ? 'Disable' : 'Enable server'}
                    </button>
                    <button
                      className="icon"
                      aria-label={`Remove ${server.name}`}
                      disabled={busy}
                      onClick={() => run(() => api(`${base}/mcp/${server.id}/delete`, {}))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {server.tools.map((tool) => (
                    <details className="tool-review" key={tool.name}>
                      <summary>
                        {tool.name}{' '}
                        <span className="pill">
                          {server.allowed.includes(tool.name)
                            ? 'Allowed · approval per call'
                            : 'Off'}
                        </span>
                      </summary>
                      <p>{tool.description}</p>
                      <pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={server.allowed.includes(tool.name)}
                          disabled={busy}
                          onChange={(e) =>
                            run(() =>
                              api(`${base}/mcp/${server.id}/configure`, {
                                enabled: server.enabled,
                                allowed: e.target.checked
                                  ? [...server.allowed, tool.name]
                                  : server.allowed.filter((n) => n !== tool.name),
                              }),
                            )
                          }
                        />
                        Allow this tool for the project
                      </label>
                      {server.enabled && server.allowed.includes(tool.name) && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const value = String(new FormData(e.currentTarget).get('arguments'));
                            run(async () => {
                              await api(`${base}/mcp-calls`, {
                                serverId: server.id,
                                tool: tool.name,
                                args: JSON.parse(value),
                                operationId: crypto.randomUUID(),
                              });
                              setSection('calls');
                            });
                          }}
                        >
                          <label>
                            Test arguments (JSON)
                            <textarea name="arguments" defaultValue="{}" rows={3} />
                          </label>
                          <button disabled={busy}>Stage test for review</button>
                        </form>
                      )}
                    </details>
                  ))}
                </article>
              ))}
            </section>
            <section className="feature-panel">
              <h2>Add a server</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget),
                    form = e.currentTarget;
                  run(async () => {
                    await api(`${base}/mcp`, {
                      name: data.get('name'),
                      transport,
                      ...(transport !== 'stdio'
                        ? {
                            url: data.get('url'),
                            token: data.get('token') || undefined,
                            ...(transport === 'agent-zero' && data.get('remoteProject')
                              ? { remoteProject: data.get('remoteProject') }
                              : {}),
                          }
                        : {
                            command: data.get('command'),
                            args: JSON.parse(String(data.get('args') || '[]')),
                            acknowledgeHostExecution: hostAck,
                          }),
                    });
                    form.reset();
                    setHostAck(false);
                  });
                }}
              >
                <label>
                  Name
                  <input name="name" required maxLength={80} placeholder="Project research" />
                </label>
                <label>
                  Transport
                  <select value={transport} onChange={(e) => setTransport(e.target.value)}>
                    <option value="http">Streamable HTTP</option>
                    <option value="agent-zero">Agent Zero bridge · preview</option>
                    <option value="stdio">Local stdio · full trust</option>
                  </select>
                </label>
                {transport !== 'stdio' ? (
                  <>
                    <label>
                      {transport === 'agent-zero' ? 'Agent Zero base URL' : 'Endpoint URL'}
                      <input
                        name="url"
                        type="url"
                        required
                        placeholder={
                          transport === 'agent-zero'
                            ? 'http://127.0.0.1:50001'
                            : 'https://example.com/mcp'
                        }
                      />
                    </label>
                    <label>
                      {transport === 'agent-zero'
                        ? 'Agent Zero MCP token'
                        : 'Bearer token (optional)'}
                      <input
                        name="token"
                        type="password"
                        autoComplete="off"
                        required={transport === 'agent-zero'}
                      />
                    </label>
                    {transport === 'agent-zero' && (
                      <>
                        <label>
                          Remote project ID (optional)
                          <input
                            name="remoteProject"
                            pattern="[A-Za-z0-9_-]{1,100}"
                            placeholder="Agent Zero project key"
                          />
                        </label>
                        <p>
                          In Agent Zero, open Settings → MCP Server, enable it, and copy its token
                          into the field above. Enter only the instance base URL. Approved calls run
                          on that instance with its tools, data, and account usage. Discovery
                          verifies the exposed catalog; individual plugin behavior still needs
                          testing.
                        </p>
                      </>
                    )}
                    <p>
                      Stored in the local encrypted vault. Get a token from your server provider;
                      this app does not reuse chat credentials.
                    </p>
                  </>
                ) : (
                  <>
                    <label>
                      Absolute executable path
                      <input name="command" placeholder="/absolute/path/to/node" required />
                    </label>
                    <label>
                      Arguments (JSON array)
                      <textarea
                        name="args"
                        defaultValue={'["/absolute/path/to/server.js"]'}
                        rows={3}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={hostAck}
                        onChange={(e) => setHostAck(e.target.checked)}
                      />
                      I trust this executable and its arguments to run with my OS account, outside a
                      sandbox. It can read or change my files.
                    </label>
                    <p>
                      Discovery starts the process. The app supplies a minimal environment and no
                      saved model credentials. This is not an installer.
                    </p>
                  </>
                )}
                <button className="primary" disabled={busy || (transport === 'stdio' && !hostAck)}>
                  Save disabled connection
                </button>
              </form>
            </section>
          </div>
        </>
      )}
      {section === 'calls' && (
        <section className="feature-panel">
          <h2>Review tool calls</h2>
          <p>
            Check the server, tool, and arguments before approving. A completed result becomes
            available to the agent through mcp_result on your next message.
          </p>
          <button onClick={() => run(refresh)} disabled={busy}>
            <RefreshCw size={14} />
            Refresh calls
          </button>
          {!data.calls.length && (
            <div className="empty-feature">
              <ShieldCheck size={28} />
              <h3>No calls to review.</h3>
              <p>Enabled MCP tools appear in the next chat turn’s capability catalog.</p>
            </div>
          )}
          {data.calls.map((call) => (
            <article className="feature-item" key={call.id}>
              <div className="panel-title">
                <h3>
                  {data.servers.find((s) => s.id === call.serverId)?.name ?? 'Removed server'} /{' '}
                  {call.tool}
                </h3>
                <span className="pill">{call.status}</span>
              </div>
              <small>
                Call {call.id} · {new Date(call.createdAt).toLocaleString()}
              </small>
              <pre>{JSON.stringify(call.args, null, 2)}</pre>
              {call.result && (
                <details>
                  <summary>Tool result</summary>
                  <pre>{call.result}</pre>
                </details>
              )}
              {call.status === 'pending' && (
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        api(`${base}/mcp-calls/${call.id}`, {
                          action: 'approve',
                          digest: call.digest,
                        }),
                      )
                    }
                  >
                    Approve & run once
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() => api(`${base}/mcp-calls/${call.id}`, { action: 'reject' }))
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
              {call.status === 'unknown' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const resolution = String(new FormData(e.currentTarget).get('resolution'));
                    run(() =>
                      api(`${base}/mcp-calls/${call.id}`, { action: 'resolve', resolution }),
                    );
                  }}
                >
                  <p className="error">
                    The remote outcome is unknown. Further calls are blocked. Check the provider
                    before clearing this hold; clearing it never retries this call.
                  </p>
                  <label>
                    How did you verify the remote outcome?
                    <textarea name="resolution" required minLength={10} maxLength={2000} />
                  </label>
                  <button disabled={busy}>Record resolution & clear hold</button>
                </form>
              )}
              {call.resolution && <p>{call.resolution}</p>}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
export function PluginHubView({ project, act }: { project?: Project; act: Act }) {
  const [catalog, setCatalog] = useState<HubCatalog | null>(null),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<HubEntry>(),
    [preview, setPreview] = useState<{ markdown: string; source: string }>(),
    [notice, setNotice] = useState('');
  useEffect(() => {
    void act(async () => setCatalog(await api('/hub')));
  }, []);
  useEffect(() => {
    setPreview(undefined);
    setSelected(undefined);
    setNotice('');
  }, [project?.id]);
  const run = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void act(async () => {
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  };
  const rows = (catalog?.entries ?? []).filter(
    (e) =>
      (filter === 'all' || (e.assessment?.status ?? 'Compatibility unknown') === filter) &&
      `${e.title} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Heading title="Agent Zero Plugin Hub">
        Browse Agent Zero community plugins and assess compatibility at a pinned source revision.
      </Heading>
      <div className="hub-toolbar">
        <label className="grow">
          Search extensions
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins, capabilities, or tags"
          />
        </label>
        <label>
          Compatibility
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All assessments</option>
            {['Requires Agent Zero', 'Port available', 'Compatibility unknown'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              setCatalog(await api('/hub/refresh', {}));
              setNotice('Catalog refreshed. No plugin code was installed.');
            })
          }
        >
          <RefreshCw size={16} />
          Refresh catalog
        </button>
      </div>
      <p className="muted">
        {catalog
          ? `${catalog.entries.length} extensions · cached ${new Date(catalog.fetchedAt).toLocaleString()}`
          : 'Catalog has not been fetched yet.'}{' '}
        ·{' '}
        <a href="https://github.com/agent0ai/a0-plugins" target="_blank" rel="noreferrer">
          Upstream catalog <ExternalLink size={12} />
        </a>
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <div className="permission-note">
        <ShieldCheck size={18} />
        <span>
          Python plugins and Agent Zero UI hooks require an Agent Zero instance. Connect its MCP
          server through the Agent Zero bridge preset in Skills & MCP. Only exposed, approved remote
          tools are available. Review and import portable SKILL.md instructions separately.
        </span>
      </div>
      {selected && (
        <section className="feature-panel hub-detail">
          <div className="panel-title">
            <h2>{selected.title}</h2>
            <button
              onClick={() => {
                setSelected(undefined);
                setPreview(undefined);
              }}
            >
              Close details
            </button>
          </div>
          <p>{selected.assessment?.reason}</p>
          <small className="wrap">
            Assessed revision {selected.commit} · {selected.assessment?.checkedAt}
          </small>
          <div className="button-row">
            {selected.assessment?.skills.map((path) => (
              <button
                disabled={busy}
                key={path}
                onClick={() =>
                  run(async () => setPreview(await api('/hub/skill', { id: selected.id, path })))
                }
              >
                Review {path}
              </button>
            ))}
          </div>
          {preview && (
            <>
              <pre>{preview.markdown}</pre>
              <p className="wrap">{preview.source}</p>
              <button
                className="primary"
                disabled={busy || !project}
                onClick={() =>
                  run(async () => {
                    await api(`/projects/${project!.id}/skills`, preview);
                    setNotice(
                      `Imported disabled into ${project!.name}. Enable it from Skills & MCP after reviewing.`,
                    );
                    setPreview(undefined);
                  })
                }
              >
                Import instructions into {project?.name ?? 'a project'}
              </button>
            </>
          )}
        </section>
      )}
      {!catalog && (
        <div className="empty-feature">
          <BookOpen size={32} />
          <h2>Load the Plugin Hub catalog</h2>
          <p>
            Refresh to fetch discovery metadata. Nothing is downloaded or executed automatically.
          </p>
        </div>
      )}
      <div className="hub-grid">
        {rows.map((entry) => (
          <article className="hub-card" key={entry.id}>
            <div className="panel-title">
              <small>{entry.version || 'Unversioned'}</small>
              <span className="pill">{entry.assessment?.status ?? 'Compatibility unknown'}</span>
            </div>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            <div className="tags">
              {entry.tags.slice(0, 4).map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p className="compatibility-reason">
              {entry.assessment?.reason ??
                'No source assessment has been recorded for this revision.'}
            </p>
            <div className="button-row">
              <button
                disabled={busy || !entry.commit}
                onClick={() =>
                  run(async () => {
                    await api('/hub/assess', { id: entry.id });
                    const next = await api<HubCatalog>('/hub');
                    setCatalog(next);
                    setSelected(next.entries.find((e) => e.id === entry.id));
                    setPreview(undefined);
                  })
                }
              >
                Assess compatibility
              </button>
              <a
                href={entry.commit ? `${entry.github}/tree/${entry.commit}` : entry.github}
                target="_blank"
                rel="noreferrer"
              >
                View source <ExternalLink size={13} />
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
