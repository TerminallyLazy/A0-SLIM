import { useState } from 'react';
import type { Project } from '../src/domain.js';
import { api } from './api.js';
export type VercelReadiness = { available: boolean; reason: string | null; revision: string };
export function ExecutionChoice({
  project,
  dockerAvailable,
  vercel,
  refresh,
  act,
}: {
  project: Project;
  dockerAvailable: boolean;
  vercel: VercelReadiness;
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const granted = project.vercelGrant?.revision === vercel.revision;
  const perform = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void act(async () => {
      await fn();
      await refresh();
    }).finally(() => setBusy(false));
  };
  const save = (execution: string) =>
    perform(async () => {
      await api(`/projects/${project.id}/execution`, {
        execution,
        ...(execution === 'vercel' ? { acknowledgeVercelUsage: true } : {}),
      });
      setConfirming(false);
      setConsent(false);
    });
  return (
    <section className="environment-card">
      <h3>Execution for new chats</h3>
      <label className="environment-choice">
        {project.name}
        <select
          aria-label="Execution for new chats"
          value={confirming ? 'vercel' : (project.execution ?? 'none')}
          disabled={busy}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'vercel' && !granted) {
              setConfirming(true);
              setConsent(false);
            } else {
              setConfirming(false);
              save(value);
            }
          }}
        >
          <option value="none">No code execution</option>
          <option value="vercel" disabled={!vercel.available}>
            Vercel Sandbox · Node.js
          </option>
          <option value="docker" disabled={!dockerAvailable}>
            Local Docker · Node.js
          </option>
        </select>
      </label>
      {!vercel.available && <p className="fine">Vercel: {vercel.reason}</p>}
      {confirming && (
        <div className="provider-setup">
          <p>
            Vercel runs the code remotely. Each call uses one temporary sandbox: 1 vCPU, a 60-second
            lifetime, a 10-second Node.js process and 64 KiB of output. Outbound network access is
            denied. SLIM limits use to three calls per turn and ten sandboxes in ten minutes across
            projects.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Allow this project’s Vercel chats to send agent-generated code and explicit text input
            to Vercel and use cloud compute that may be billed. No automatic folder upload or model
            credentials.
          </label>
          <div className="environment-actions">
            <button disabled={busy || !consent || !vercel.available} onClick={() => save('vercel')}>
              Use Vercel for new chats
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setConsent(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <p className="fine">
        Existing chats keep their environment. Start a new chat to use this selection. Returned
        files still need your review before they change the local project.
      </p>
      {project.vercelGrant && (
        <div className="environment-actions">
          <button
            disabled={busy}
            onClick={() => perform(() => api(`/projects/${project.id}/vercel/revoke`, {}))}
          >
            Revoke Vercel usage
          </button>
          <span className="fine">Blocks future calls. A running sandbox still needs cleanup.</span>
        </div>
      )}
    </section>
  );
}
