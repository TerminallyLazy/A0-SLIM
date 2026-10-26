import { useEffect, useState } from 'react';
import { ArrowUpRight, Box, Check, Cloud, ShieldCheck } from 'lucide-react';
import type { Project } from '../src/domain.js';
import { api } from './api.js';
import { Heading } from './workspace.js';

type Actions = { refresh: () => Promise<void>; act: (fn: () => Promise<unknown>) => Promise<void> };
const clouds = [
  {
    id: 'vercel',
    name: 'Vercel Sandbox',
    allowance: 'Hobby: 5 CPU hours, 420 GB-hours of memory and 5,000 creations per month.',
    detail: 'Hobby pauses new creation at its quota. Paid plans can incur usage charges.',
    url: 'https://vercel.com/docs/sandbox/pricing',
    fields: [
      ['teamId', 'Team ID', false],
      ['projectId', 'Project ID', false],
      ['token', 'Access token', true],
    ],
  },
  {
    id: 'modal',
    name: 'Modal',
    allowance: 'Starter: $30 in free compute credit every month.',
    detail: 'Credit is shared across Modal compute. Usage beyond the allowance may be billed.',
    url: 'https://modal.com/pricing',
    fields: [
      ['appName', 'App name', false, 'a0-slim'],
      ['environment', 'Environment', false, 'main'],
      ['tokenId', 'Token ID', true],
      ['tokenSecret', 'Token secret', true],
    ],
  },
] as const;

export function Environments({
  configured,
  modalConfigured,
  receipts,
  project,
  refresh,
  act,
}: Actions & {
  configured: boolean;
  modalConfigured: boolean;
  receipts: Record<string, any>[];
  project?: Project;
}) {
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(''),
    [consent, setConsent] = useState<Record<string, boolean>>({}),
    [local, setLocal] = useState<{ available: boolean; message?: string; version?: string } | null>(
      null,
    );
  useEffect(() => {
    void act(async () => setLocal(await api('/sandbox/docker')));
  }, []);
  const perform = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void act(fn).finally(() => setBusy(false));
  };
  return (
    <>
      <Heading label="A place for the work" title="Boundaries you can see.">
        Start on your own computer, or connect a cloud sandbox with a free allowance. Choose the
        environment that fits your work.
      </Heading>
      <section className="environment-card">
        <div className="environment-heading">
          <div className="connection-glyph">
            <Box size={21} />
          </div>
          <div>
            <h3>Local Docker</h3>
            <p>No cloud compute charges · uses your computer</p>
          </div>
          <span className="pill">{local?.available ? 'Ready' : 'Setup required'}</span>
        </div>
        <p>
          Disposable Node.js containers with no network, host-folder mounts or credentials. Five
          seconds per call, 128 MiB memory, bounded output. Local engine licensing and electricity
          are separate.
        </p>
        {local?.message && <p className="setup-command">{local.message}</p>}
        <div className="environment-actions">
          <button
            disabled={busy}
            onClick={() => perform(async () => setLocal(await api('/sandbox/docker')))}
          >
            Refresh availability
          </button>
          <button
            disabled={busy || !local?.available}
            onClick={() =>
              perform(async () => {
                await api('/sandbox/docker/proof', {});
                await refresh();
              })
            }
          >
            Run local check
          </button>
        </div>
        {project && (
          <div className="environment-choice">
            <label>
              Execution for new chats in {project.name}
              <select
                aria-label="Execution for new chats"
                value={project.execution ?? 'none'}
                disabled={busy}
                onChange={(event) => {
                  const execution = event.target.value;
                  perform(async () => {
                    await api(`/projects/${project.id}/execution`, { execution });
                    await refresh();
                  });
                }}
              >
                <option value="none">No code execution</option>
                <option value="docker" disabled={!local?.available}>
                  Local Docker · isolated Node.js
                </option>
              </select>
            </label>
            <p className="fine">
              Existing chats keep their environment. Every project file change still requires your
              review.
            </p>
          </div>
        )}
      </section>
      <div className="notice">
        <ShieldCheck size={18} />
        <div>
          <strong>Cloud connections begin with a synthetic check.</strong>
          <p>
            No project files or model keys leave your computer during these checks. Cloud agent
            execution stays off until its adapter is validated.
          </p>
        </div>
      </div>
      {clouds.map((cloud) => {
        const saved = cloud.id === 'vercel' ? configured : modalConfigured;
        return (
          <section className="environment-card" key={cloud.id}>
            <div className="environment-heading">
              <div className="connection-glyph">
                <Cloud size={21} />
              </div>
              <div>
                <h3>{cloud.name}</h3>
                <p>{saved ? 'Connection saved · ready to check' : 'Optional cloud connection'}</p>
              </div>
              <span className="pill">Free allowance</span>
            </div>
            <p>
              <strong>{cloud.allowance}</strong> {cloud.detail}
            </p>
            <div className="environment-actions">
              <a className="text-link" href={cloud.url} target="_blank" rel="noreferrer">
                Current pricing <ArrowUpRight size={14} />
              </a>
              <button
                disabled={busy}
                onClick={() => setEditing(editing === cloud.id ? '' : cloud.id)}
              >
                {saved ? 'Update connection' : 'Configure'}
              </button>
            </div>
            {editing === cloud.id && (
              <form
                className="settings-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget,
                    data = Object.fromEntries(new FormData(form));
                  perform(async () => {
                    await api(`/sandbox/${cloud.id}`, data);
                    form.reset();
                    setEditing('');
                    await refresh();
                  });
                }}
              >
                <div className="form-grid">
                  {cloud.fields.map((field) => (
                    <label key={field[0]}>
                      {field[1]}
                      <input
                        name={field[0]}
                        type={field[2] ? 'password' : 'text'}
                        required
                        autoComplete="off"
                        defaultValue={field.length > 3 ? field[3] : undefined}
                      />
                    </label>
                  ))}
                </div>
                <button className="primary" disabled={busy}>
                  Save {cloud.name} connection
                </button>
              </form>
            )}
            {saved && (
              <div className="proof-form">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!consent[cloud.id]}
                    onChange={(e) => setConsent({ ...consent, [cloud.id]: e.target.checked })}
                  />
                  Create one temporary sandbox using my {cloud.name} account. I understand that
                  usage can exceed my free allowance.
                </label>
                <button
                  className="primary"
                  disabled={busy || !consent[cloud.id]}
                  onClick={() =>
                    perform(async () => {
                      await api(`/sandbox/${cloud.id}/proof`, { acknowledgeUsage: true });
                      setConsent({ ...consent, [cloud.id]: false });
                      await refresh();
                    })
                  }
                >
                  {busy ? 'Checking…' : `Check ${cloud.name}`}
                </button>
              </div>
            )}
          </section>
        );
      })}
      <p className="fine">
        Cloud checks have a 60-second sandbox lifetime and deny outbound network. Modal may retain
        its app and cached base image; a terminated receipt confirms stopped compute, not
        account-wide deletion. Allowances checked October 26, 2026; your provider dashboard is
        authoritative.
      </p>
      <div className="list-label">
        Execution receipts <span>{receipts.length}</span>
      </div>
      {!receipts.length && <p className="empty-row">Your first check will appear here.</p>}
      {receipts.map((receipt) => {
        const provider =
          receipt.kind === 'docker-sandbox'
            ? 'docker'
            : receipt.kind === 'modal-sandbox-proof'
              ? 'modal'
              : 'vercel';
        return (
          <div className="receipt" key={receipt.id}>
            <div>
              <Check size={16} />
              <strong>
                {provider === 'docker' ? 'Local Docker' : provider === 'modal' ? 'Modal' : 'Vercel'}{' '}
                ·{' '}
                {receipt.status === 'passed'
                  ? 'Completed'
                  : receipt.status === 'pending'
                    ? 'Pending or interrupted'
                    : 'Did not pass'}
              </strong>
              <span className="pill">Cleanup: {receipt.cleanup}</span>
            </div>
            <p>
              {receipt.environmentId ?? 'No environment created'} ·{' '}
              {new Date(receipt.startedAt).toLocaleString()}
            </p>
            {receipt.message && <p>{receipt.message}</p>}
            {receipt.reconcileMessage && <p className="error">{receipt.reconcileMessage}</p>}
            {['unknown', 'stopped'].includes(receipt.cleanup) && (
              <button
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await api(`/sandbox/${provider}/receipts/${receipt.id}/reconcile`, {});
                    await refresh();
                  })
                }
              >
                Recheck & clean up
              </button>
            )}
            {receipt.cleanup === 'unknown' && (
              <p className="error">
                New work on this adapter is blocked until this exact resource is reconciled.
              </p>
            )}
          </div>
        );
      })}
      <p className="fine">
        <a href="https://e2b.dev/pricing" target="_blank" rel="noreferrer">
          E2B
        </a>{' '}
        offers $100 one-time trial credit;{' '}
        <a href="https://www.daytona.io/pricing" target="_blank" rel="noreferrer">
          Daytona
        </a>{' '}
        offers $200 in free compute. These are trial offers, and their adapters are planned.
      </p>
    </>
  );
}
