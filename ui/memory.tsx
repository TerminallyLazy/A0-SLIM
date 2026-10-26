import { useEffect, useState } from 'react';
import { Brain, Download, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { Project } from '../src/domain.js';
import type { MemoryNote, MemoryPolicy } from '../src/memory/store.js';
import type { EmbeddingConnection, IndexJob } from '../src/memory/embeddings.js';
import { api } from './api.js';
import type { AddonState } from '../src/memory/embedding-addon.js';
import { Heading } from './workspace.js';
import { downloadText, type Act } from './extensions.js';
type MemoryData = {
  notes: MemoryNote[];
  total: number;
  policy: MemoryPolicy;
  index: { active: string | null; jobs: IndexJob[]; sharing: string | null };
};
type EmbeddingData = {
  connections: EmbeddingConnection[];
  local: {
    status: string;
    runtime: AddonState;
    downloaded: number;
    error?: string;
    location: string;
    manifest: { id: string; revision: string; bytes: number; license: string; dimension: number };
  };
};
export function MemoryWorkspace({
  project,
  act,
  compact = false,
}: {
  project?: Project;
  act: Act;
  compact?: boolean;
}) {
  const [data, setData] = useState<MemoryData>(),
    [query, setQuery] = useState(''),
    [area, setArea] = useState(''),
    [embeddings, setEmbeddings] = useState<EmbeddingData>(),
    [connectionId, setConnectionId] = useState('local-minilm'),
    [sharing, setSharing] = useState(false),
    [runtimeConsent, setRuntimeConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [section, setSection] = useState('knowledge'),
    [mode, setMode] = useState('lexical'),
    [backupAck, setBackupAck] = useState<string[]>([]),
    [editing, setEditing] = useState<MemoryNote>(),
    [backups, setBackups] = useState<{ name: string; bytes: number }[]>([]);
  const base = `/projects/${project?.id}/memory`;
  const refresh = async () => {
    if (!project) return;
    const [memory, embedding] = await Promise.all([
      api<MemoryData>(`${base}?query=${encodeURIComponent(query)}&area=${area}`),
      api<EmbeddingData>('/embeddings'),
    ]);
    setData(memory);
    setEmbeddings(embedding);
  };
  useEffect(() => {
    void act(refresh);
  }, [project?.id]);
  useEffect(() => {
    if (!project) return;
    const abort = new AbortController();
    void api<MemoryData>(
      `${base}?query=${encodeURIComponent(query)}&area=${area}`,
      undefined,
      abort.signal,
    )
      .then((d) => {
        setData(d);
        setMode('lexical');
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          void act(async () => {
            throw e;
          });
      });
    return () => abort.abort();
  }, [query, area]);
  const activeJob = data?.index.jobs.some((j) => j.status === 'building'),
    downloading = embeddings && ['downloading', 'verifying'].includes(embeddings.local.status),
    installing = embeddings?.local.runtime.status === 'installing';
  useEffect(() => {
    if (!activeJob && !downloading && !installing) return;
    const interval = setInterval(() => void act(refresh), 1500);
    return () => clearInterval(interval);
  }, [activeJob, downloading, installing, query, area]);
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
  if (!project)
    return (
      <Heading title="Choose a project">Memory and embedding indexes belong to a project.</Heading>
    );
  const connection = embeddings?.connections.find((c) => c.id === connectionId);
  return (
    <>
      {!compact && (
        <Heading title="Memory">
          Save and search project knowledge. Control what the agent can recall, save, or delete.
        </Heading>
      )}
      {!compact && (
        <div className="feature-tabs" role="tablist" aria-label="Memory sections">
          {[
            ['knowledge', 'Project knowledge'],
            ['embeddings', 'Embeddings & models'],
            ['privacy', 'Import, export & retention'],
          ].map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={section === id}
              className={section === id ? 'selected' : ''}
              onClick={() => setSection(id!)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {section === 'knowledge' && (
        <>
          <section className="memory-permissions">
            <div>
              <h3>Agent memory</h3>
              <p>
                Recall relevant notes at the start of a turn, or search them with memory_load.
                Saving is a separate permission.
              </p>
            </div>
            {(['read', 'write'] as const).map((key) => (
              <label className="check-row" key={key}>
                <input
                  type="checkbox"
                  checked={data?.policy[key] ?? false}
                  disabled={busy || !data}
                  onChange={(e) =>
                    run(() => api(`${base}/policy`, { ...data!.policy, [key]: e.target.checked }))
                  }
                />
                {key === 'read' ? 'Allow recall' : 'Allow save & delete'}
              </label>
            ))}
          </section>
          <form
            className="hub-toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void act(async () => {
                try {
                  const result = await api(`${base}/search`, { query, area, semantic: true });
                  setData((d) => (d ? { ...d, notes: result.notes } : d));
                  setMode(result.mode);
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            <label className="grow">
              Search memory
              <input
                type="search"
                placeholder="Find a fact, decision, or solution…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Area
              <select value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">All areas</option>
                <option value="main">Main</option>
                <option value="fragments">Fragments</option>
                <option value="solutions">Solutions</option>
              </select>
            </label>
            {!compact && (
              <button disabled={busy || !query || !data?.index.active}>
                <Search size={16} />
                Hybrid search
              </button>
            )}
          </form>
          <p className="muted">
            {data?.total ?? 0} notes · {mode} ·{' '}
            {data?.index.active ? 'Embedding index enabled' : 'Works without an embedding model'}
          </p>
          <div className={compact ? '' : 'extension-grid'}>
            <section className="feature-panel">
              <h2>{area ? `${area[0]!.toUpperCase()}${area.slice(1)}` : 'Project knowledge'}</h2>
              {!data?.notes.length && (
                <div className="empty-feature">
                  <Brain size={28} />
                  <h3>{query ? 'No matching notes.' : 'No saved memories'}</h3>
                  <p>
                    {query
                      ? 'Try a different phrase or area.'
                      : 'Save a useful fact, a fragment of research, or a solution worth keeping.'}
                  </p>
                </div>
              )}
              {data?.notes.map((note) => (
                <article className="feature-item memory-note" key={note.id}>
                  <div className="panel-title">
                    <span className="pill">{note.area}</span>
                    <small>{new Date(note.updated).toLocaleDateString()}</small>
                  </div>
                  <p className="memory-text">{note.text}</p>
                  <small className="wrap">Source: {note.source}</small>
                  <small className="wrap">ID: {note.id}</small>
                  <div className="button-row">
                    <button disabled={busy} onClick={() => setEditing(note)}>
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          api(`${base}/${note.id}/delete`, { operationId: crypto.randomUUID() }),
                        )
                      }
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </section>
            {!compact && (
              <section className="feature-panel">
                <h2>{editing ? 'Edit memory' : 'Save a memory'}</h2>
                <form
                  key={editing?.id ?? 'new'}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      fd = new FormData(form);
                    run(async () => {
                      await api(base, {
                        note: {
                          text: fd.get('text'),
                          area: fd.get('area'),
                          source: fd.get('source'),
                        },
                        operationId: crypto.randomUUID(),
                        ...(editing ? { id: editing.id } : {}),
                      });
                      setEditing(undefined);
                      form.reset();
                    });
                  }}
                >
                  <label>
                    Area
                    <select name="area" defaultValue={editing?.area ?? 'main'}>
                      <option value="main">Main · durable facts & preferences</option>
                      <option value="fragments">Fragments · notes & research</option>
                      <option value="solutions">Solutions · verified approaches</option>
                    </select>
                  </label>
                  <label>
                    Knowledge
                    <textarea
                      name="text"
                      rows={8}
                      defaultValue={editing?.text ?? ''}
                      maxLength={16000}
                      required
                      placeholder="What should this project remember?"
                    />
                  </label>
                  <label>
                    Source / evidence
                    <input
                      name="source"
                      defaultValue={editing?.source ?? 'User note'}
                      maxLength={500}
                      required
                      placeholder="User note, file path, or source URL"
                    />
                  </label>
                  <div className="button-row">
                    <button className="primary" disabled={busy}>
                      Save memory
                    </button>
                    {editing && (
                      <button type="button" onClick={() => setEditing(undefined)}>
                        Cancel edit
                      </button>
                    )}
                  </div>
                </form>
                <div className="permission-note">
                  <ShieldCheck size={16} />
                  <span>
                    Notes are project-scoped. They never grant permission to execute instructions,
                    and are not automatically copied into other projects.
                  </span>
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {section === 'embeddings' && embeddings && (
        <>
          <div className="extension-grid">
            <section className="feature-panel">
              <div className="panel-title">
                <h2>Local Hugging Face model</h2>
                <span className="pill">{embeddings.local.status}</span>
              </div>
              <h3>Optional local runtime</h3>
              <p>
                Transformers.js and ONNX Runtime run embeddings on this computer. PyTorch is not
                needed. Lexical search and hosted embeddings work without this add-on.
              </p>
              <p role="status">Runtime: {embeddings.local.runtime.status.replaceAll('-', ' ')}</p>
              {embeddings.local.runtime.error && (
                <p role="status">{embeddings.local.runtime.error}</p>
              )}
              {embeddings.local.runtime.status !== 'ready' && !installing && (
                <>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={runtimeConsent}
                      onChange={(e) => setRuntimeConsent(e.target.checked)}
                    />
                    Download the optional runtime from npm. Allow about 500 MB of extra storage;
                    model files are separate.
                  </label>
                  <button
                    disabled={busy || downloading || !runtimeConsent}
                    onClick={() =>
                      run(async () => {
                        await api('/embeddings/runtime', {
                          action: 'install',
                          acknowledgeDownload: true,
                        });
                        setRuntimeConsent(false);
                      })
                    }
                  >
                    Install local embeddings
                  </button>
                </>
              )}
              {installing && (
                <button
                  disabled={busy}
                  onClick={() => run(() => api('/embeddings/runtime', { action: 'cancel' }))}
                >
                  Cancel runtime installation
                </button>
              )}
              {['ready', 'interrupted', 'failed'].includes(embeddings.local.runtime.status) && (
                <button
                  disabled={busy || downloading || activeJob}
                  onClick={() => run(() => api('/embeddings/runtime', { action: 'remove' }))}
                >
                  Remove embedding runtime
                </button>
              )}
              <p className="fine">
                Removing the runtime keeps downloaded models, memory and index data. Search falls
                back to text until you reinstall it.
              </p>
              <h3>MiniLM · 384 dimensions</h3>
              <p>
                Quantized ONNX model running on this computer’s CPU in a worker. No chat
                subscription or API key is used.
              </p>
              <div className="model-facts">
                <span>Download</span>
                <strong>{(embeddings.local.manifest.bytes / 1024 / 1024).toFixed(1)} MiB</strong>
                <span>License</span>
                <strong>{embeddings.local.manifest.license}</strong>
                <span>Revision</span>
                <code>{embeddings.local.manifest.revision.slice(0, 12)}</code>
              </div>
              <p className="wrap">
                <small>Storage: {embeddings.local.location}</small>
              </p>
              <a
                href={`https://huggingface.co/${embeddings.local.manifest.id}/tree/${embeddings.local.manifest.revision}`}
                target="_blank"
                rel="noreferrer"
              >
                Model card & pinned files ↗
              </a>
              {downloading && (
                <>
                  <progress
                    aria-label="Model download"
                    value={embeddings.local.downloaded}
                    max={embeddings.local.manifest.bytes}
                  />
                  <p>{(embeddings.local.downloaded / 1024 / 1024).toFixed(1)} MiB downloaded</p>
                </>
              )}
              {embeddings.local.error && <p role="status">{embeddings.local.error}</p>}
              <div className="button-row">
                <button
                  disabled={
                    busy ||
                    downloading ||
                    embeddings.local.runtime.status !== 'ready' ||
                    embeddings.local.status === 'ready'
                  }
                  onClick={() => run(() => api('/embeddings/local', { action: 'download' }))}
                >
                  <Download size={15} />
                  {['paused', 'failed'].includes(embeddings.local.status)
                    ? 'Resume download'
                    : 'Download & verify'}
                </button>
                {downloading && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api('/embeddings/local', { action: 'pause' }))}
                  >
                    Pause
                  </button>
                )}
                <button
                  disabled={busy || downloading}
                  onClick={() => run(() => api('/embeddings/local', { action: 'delete' }))}
                >
                  Remove model
                </button>
              </div>
              <p>
                Files are checked against pinned SHA-256 hashes. Ready means local-only inference
                passed; no network is required for subsequent inference. Completed files are reused
                after a pause.
              </p>
            </section>
            <section className="feature-panel">
              <h2>Project embedding index</h2>
              <p>
                Build a new index without mixing vector spaces. Existing search stays available
                during a rebuild. Edited notes remain searchable by text until rebuilt.
              </p>
              <label>
                Embedding connection
                <select
                  value={connectionId}
                  onChange={(e) => {
                    setConnectionId(e.target.value);
                    setSharing(false);
                  }}
                >
                  {embeddings.connections.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name} · {c.dimension}d
                    </option>
                  ))}
                </select>
              </label>
              {connection?.kind === 'compatible' && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={sharing}
                    onChange={(e) => setSharing(e.target.checked)}
                  />
                  Allow this project’s saved memory text and semantic search queries to be sent to{' '}
                  {connection.name}. Provider usage may apply.
                </label>
              )}
              <div className="button-row">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    activeJob ||
                    (connection?.kind === 'compatible' && !sharing) ||
                    (connection?.kind === 'local' && embeddings.local.status !== 'ready')
                  }
                  onClick={() =>
                    run(() =>
                      api(`${base}/index`, {
                        action: 'build',
                        connectionId,
                        acknowledgeSharing: sharing,
                      }),
                    )
                  }
                >
                  {data?.index.active ? 'Rebuild / change index' : 'Build index'}
                </button>
                {activeJob && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => api(`${base}/index`, { action: 'pause' }))}
                  >
                    Pause indexing
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => run(() => api(`${base}/index`, { action: 'lexical' }))}
                >
                  Use lexical only
                </button>
              </div>
              <p>
                Active:{' '}
                {embeddings.connections.find((c) => c.id === data?.index.active)?.name ??
                  'Lexical only'}
              </p>
              {data?.index.jobs.map((j) => (
                <div key={j.id} className="feature-item">
                  <div className="panel-title">
                    <strong>
                      {embeddings.connections.find((c) => c.id === j.connectionId)?.name ??
                        'Removed connection'}
                    </strong>
                    <span className="pill">{j.status}</span>
                  </div>
                  <progress aria-label="Index progress" value={j.done} max={Math.max(1, j.total)} />
                  <small>
                    {j.done} / {j.total} notes · space {j.namespace.slice(0, 12)}
                  </small>
                  {j.error && <p>{j.error}</p>}
                </div>
              ))}
            </section>
          </div>
          <section className="feature-panel">
            <h2>Separate embedding connections</h2>
            <p>
              Use an OpenAI-compatible /embeddings endpoint, including an independently configured
              local service. Chat connections and subscription credentials are never reused.
            </p>
            {embeddings.connections
              .filter((c) => c.kind === 'compatible')
              .map((c) => (
                <div className="feature-item" key={c.id}>
                  <div className="panel-title">
                    <h3>{c.name}</h3>
                    <button
                      disabled={busy}
                      onClick={() => run(() => api(`/embeddings/${c.id}/delete`, {}))}
                    >
                      Remove
                    </button>
                  </div>
                  <p className="wrap">
                    {c.baseUrl} · {c.model} · {c.dimension}d · revision {c.revision}
                  </p>
                  <small>
                    {c.hasCredential ? 'Credential encrypted locally' : 'No credential'}
                  </small>
                </div>
              ))}
            <details>
              <summary>Add embedding connection</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget,
                    fd = new FormData(form);
                  run(async () => {
                    await api('/embeddings', {
                      name: fd.get('name'),
                      baseUrl: fd.get('baseUrl'),
                      model: fd.get('model'),
                      revision: fd.get('revision'),
                      dimension: Number(fd.get('dimension')),
                      apiKey: fd.get('apiKey') || undefined,
                    });
                    form.reset();
                  });
                }}
              >
                <div className="form-grid">
                  <label>
                    Name
                    <input name="name" required placeholder="My embedding service" />
                  </label>
                  <label>
                    Base URL
                    <input
                      name="baseUrl"
                      type="url"
                      required
                      placeholder="https://api.openai.com/v1"
                    />
                  </label>
                  <label>
                    Model
                    <input name="model" required placeholder="text-embedding-3-small" />
                  </label>
                  <label>
                    Model revision / namespace label
                    <input name="revision" required placeholder="provider-default-2026-10" />
                  </label>
                  <label>
                    Dimensions
                    <input
                      type="number"
                      name="dimension"
                      required
                      min={1}
                      max={4096}
                      defaultValue={1536}
                    />
                  </label>
                  <label>
                    API key (optional)
                    <input name="apiKey" type="password" autoComplete="off" />
                  </label>
                </div>
                <button className="primary" disabled={busy}>
                  Save embedding connection
                </button>
              </form>
            </details>
          </section>
        </>
      )}
      {section === 'privacy' && (
        <section className="feature-panel">
          <h2>Import & export memory</h2>
          <p>
            Export includes memory text, areas, sources, and timestamps. It excludes embedding
            credentials and vectors. Imports preserve source labels and create fresh local records.
          </p>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                run(async () =>
                  downloadText(
                    'a0-slim-memory.json',
                    JSON.stringify(await api(`${base}/export`), null, 2),
                    'application/json',
                  ),
                )
              }
            >
              <Download size={16} />
              Export project memory
            </button>
          </div>
          <label>
            Import memory JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  run(async () => {
                    if (file.size > 250000)
                      throw new Error('Import file must be at most 250 KB; split larger exports.');
                    await api(`${base}/import`, {
                      document: JSON.parse(await file.text()),
                      operationId: crypto.randomUUID(),
                    });
                  });
                e.target.value = '';
              }}
            />
          </label>
          <hr />
          <h2>Deletion & retained copies</h2>
          <p>
            Deleting a note removes its active text, search entry, and vectors. Earlier chats, tool
            results, exports, OS backups, and schema migration backups may still contain copies.
            Local storage is private to your OS account; the memory database itself is not
            encrypted.
          </p>
          <button
            disabled={busy}
            onClick={() => run(async () => setBackups(await api('/memory/backups')))}
          >
            List migration backups
          </button>
          {backups.map((b) => (
            <div key={b.name} className="feature-item">
              <p className="wrap">
                {b.name} · {(b.bytes / 1024).toFixed(1)} KiB
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={backupAck.includes(b.name)}
                  onChange={(e) =>
                    setBackupAck(
                      e.target.checked
                        ? [...backupAck, b.name]
                        : backupAck.filter((n) => n !== b.name),
                    )
                  }
                />
                I understand this deletes the entire migration backup, including other saved app
                data.
              </label>
              <button
                disabled={busy || !backupAck.includes(b.name)}
                onClick={() =>
                  run(async () => {
                    await api('/memory/backups/delete', { name: b.name, acknowledge: true });
                    setBackups(await api('/memory/backups'));
                  })
                }
              >
                Delete this backup
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
