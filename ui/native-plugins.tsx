import { useEffect, useState } from 'react';
import type { NativePluginState } from '../src/extensions/native-plugins.js';
import { api } from './api.js';
import type { Act } from './extensions.js';

export function NativePluginSetup({ projectId, act }: { projectId: string; act: Act }) {
  const [data, setData] = useState<NativePluginState>(),
    [database, setDatabase] = useState(''),
    [download, setDownload] = useState(false),
    [host, setHost] = useState(false),
    [busy, setBusy] = useState(false);
  const base = `/projects/${projectId}/native-plugins`;
  const refresh = async () => {
    const value = await api<NativePluginState>(base);
    setData(value);
    return value;
  };
  useEffect(() => {
    void act(async () => {
      const value = await refresh();
      setDatabase(value.binding?.database ?? '');
    });
  }, [projectId]);
  useEffect(() => {
    if (data?.runtime.status !== 'installing') return;
    const timer = setInterval(() => void act(refresh), 1500);
    return () => clearInterval(timer);
  }, [data?.runtime.status, projectId]);
  const run = (fn: () => Promise<unknown>) => {
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
  return (
    <section className="feature-panel native-plugin-setup" aria-label="Use DB Hub in SLIM">
      <h3>Use DB Hub in SLIM</h3>
      <p>
        Run the original DB Hub status and schema tools in a native SLIM chat. Agent Zero is not
        required.
      </p>
      <p className="muted">
        SQLite only · read-only · no database writes, memory replacement or Agent Zero screens.
      </p>
      {!data ? (
        <p role="status">Loading plugin setup…</p>
      ) : (
        <>
          <p role="status">
            Runtime: {data.runtime.status}
            {data.binding?.enabled ? ' · DB Hub enabled for this project' : ''}
          </p>
          {data.runtime.error && <p className="error">{data.runtime.error}</p>}
          {data.runtime.status !== 'ready' && (
            <>
              <p>
                SLIM downloads Python ({Math.ceil(data.runtime.downloadBytes / 1_000_000)} MB
                compressed), pinned database libraries and the reviewed plugin files into its
                private runtime directory.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={download}
                  onChange={(e) => setDownload(e.target.checked)}
                />
                Download this optional runtime and plugin source.
              </label>
              <button
                disabled={
                  busy || !download || ['installing', 'unsupported'].includes(data.runtime.status)
                }
                onClick={() =>
                  run(() => api('/native-plugins/install', { acknowledgeDownload: true }))
                }
              >
                {data.runtime.status === 'installing' ? 'Installing…' : 'Install DB Hub support'}
              </button>
            </>
          )}
          {data.runtime.status === 'ready' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => api(`${base}/db_hub`, { database, acknowledgeHostExecution: host }));
              }}
            >
              <label>
                SQLite file in this project
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="data/example.sqlite"
                  required
                  maxLength={2048}
                />
              </label>
              <p>
                The worker reads this existing database. Paths are relative to the selected project;
                symlinks are refused.
              </p>
              <label className="check-row">
                <input type="checkbox" checked={host} onChange={(e) => setHost(e.target.checked)} />
                Allow the reviewed local plugin worker to run. It uses my OS account; tool approvals
                do not sandbox the process.
              </label>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy || !host || !database.trim() || data.unresolved.length > 0}
                >
                  Enable DB Hub tools
                </button>
                {data.binding?.enabled && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => api(`${base}/db_hub/disable`, {}))}
                  >
                    Disable tools
                  </button>
                )}
              </div>
              {data.binding?.enabled && (
                <p>
                  Ready in native chats. Ask for the database schema; the selected project access
                  mode governs tool calls.
                </p>
              )}
            </form>
          )}
          {data.unresolved.map((operation) => (
            <form
              key={operation.id}
              onSubmit={(e) => {
                e.preventDefault();
                const resolution = String(new FormData(e.currentTarget).get('resolution'));
                run(() =>
                  api(`${base}/db_hub/reconcile`, { operationId: operation.id, resolution }),
                );
              }}
            >
              <p className="error">
                Operation {operation.id}: {operation.status}. Inspect the database outcome before
                clearing this hold. This never replays the operation.
              </p>
              {operation.status === 'unknown' && (
                <>
                  <label>
                    How did you verify the outcome?
                    <textarea name="resolution" required minLength={10} maxLength={2000} />
                  </label>
                  <button disabled={busy}>Record resolution</button>
                </>
              )}
            </form>
          ))}
          <small className="wrap">
            Plugin {data.recipe.version} · adapter {data.recipe.adapterVersion} · source{' '}
            {data.recipe.commit}
          </small>
        </>
      )}
    </section>
  );
}
