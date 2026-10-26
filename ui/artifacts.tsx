import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, FileText, ShieldCheck } from 'lucide-react';
import type { Operation } from '../src/policy/operations.js';
import { api } from './api.js';
export type ArtifactSummary = Omit<Operation, 'content' | 'before'>;
export function Artifacts({
  items,
  refresh,
  act,
}: {
  items: ArtifactSummary[];
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Operation | null>(null),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!items.some((i) => i.id === selected)) setSelected(items[0]?.id ?? '');
  }, [items, selected]);
  const summary = items.find((i) => i.id === selected);
  useEffect(() => {
    setDetail(null);
    setReviewed(false);
    setCurrent(null);
    if (!selected) return;
    const abort = new AbortController();
    void api<Operation>(`/artifacts/${selected}`, undefined, abort.signal)
      .then(setDetail)
      .catch(() => {});
    return () => abort.abort();
  }, [selected, summary?.status]);
  const action = (name: string, extra: Record<string, unknown> = {}) => {
    if (!detail) return;
    setBusy(true);
    void act(async () => {
      const updated = await api<Operation>(
        `/artifacts/${detail.id}/${name}`,
        name === 'reconcile' ? {} : { digest: detail.digest, ...extra },
      );
      setDetail(updated);
      await refresh();
    }).finally(() => setBusy(false));
  };
  return (
    <>
      <div className="eyebrow">From idea to file</div>
      <h3>Artifacts</h3>
      <p>
        Review the destination and content before applying a change. Downloads stay separate from
        your project.
      </p>
      {!items.length && (
        <div className="artifact-empty">
          <FileText size={28} />
          <p>Ask A0 SLIM to draft a file. Its preview will appear here.</p>
        </div>
      )}
      {items.map((item) => (
        <button
          key={item.id}
          className={`artifact-item ${selected === item.id ? 'selected' : ''}`}
          onClick={() => setSelected(item.id)}
        >
          <FileText size={15} />
          <span>
            {item.path}
            <small>{item.status === 'pending' ? 'Awaiting your review' : item.status}</small>
          </span>
          {item.status === 'applied' && <Check size={15} />}
        </button>
      ))}
      {detail && (
        <section className="artifact-review" aria-label={`Review ${detail.path}`}>
          <div className="artifact-title">
            <ShieldCheck size={17} />
            <strong>{detail.before === null ? 'Create file' : 'Replace file'}</strong>
            <span className="pill">{detail.status}</span>
          </div>
          <p className="file-path">{detail.path}</p>
          <details>
            <summary>
              Existing content {detail.before === null ? '· file does not exist' : ''}
            </summary>
            <pre className="artifact-code before">{detail.before ?? 'No existing file.'}</pre>
          </details>
          <div className="list-label">Proposed content</div>
          <pre className="artifact-code after">{detail.content || '(empty file)'}</pre>
          <p className="fine">
            Approval applies only to this exact content and destination. If the existing file
            changed, the application stops for a fresh review.
          </p>
          <div className="artifact-actions">
            {detail.status === 'pending' && (
              <>
                <button className="primary" disabled={busy} onClick={() => action('apply')}>
                  {busy ? 'Applying…' : 'Approve & apply'} <Check size={14} />
                </button>
                <button disabled={busy} onClick={() => action('reject')}>
                  Reject
                </button>
              </>
            )}
            {['unknown', 'conflict'].includes(detail.status) && (
              <button className="primary" disabled={busy} onClick={() => action('reconcile')}>
                Check file outcome
              </button>
            )}
            <a className="text-link" href={`/api/v1/artifacts/${detail.id}/download`} download>
              <ArrowDownToLine size={14} /> Download
            </a>
          </div>
          {detail.status === 'unknown' && (
            <p className="notice">
              Application was interrupted. Further changes in this project are blocked until the
              file outcome is checked.
            </p>
          )}
          {detail.status === 'conflict' && (
            <div className="conflict-review">
              <p className="error">
                The current file matches neither version. Review it before clearing the block.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await api(
                      `/projects/${detail.projectId}/files?read=true&path=${encodeURIComponent(detail.path)}`,
                    );
                    setCurrent(result.text);
                  })
                }
              >
                Read current file
              </button>
              {current !== null && (
                <>
                  <pre className="artifact-code">{current}</pre>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{' '}
                    I reviewed this file and will keep its current content.
                  </label>
                  <button
                    disabled={!reviewed || busy}
                    onClick={() => action('reject', { acknowledgeConflict: true })}
                  >
                    Resolve without changing file
                  </button>
                </>
              )}
            </div>
          )}
          {detail.status === 'applied' && (
            <p className="notice">
              <Check size={16} /> Saved in your project.
            </p>
          )}
        </section>
      )}
    </>
  );
}
