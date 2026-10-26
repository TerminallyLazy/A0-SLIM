import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import type { Project } from '../src/domain.js';
import { api } from './api.js';
import { Heading } from './workspace.js';

type Actions = { refresh: () => Promise<void>; act: (fn: () => Promise<unknown>) => Promise<void> };
import { sandboxProviders as clouds } from './sandbox-providers.js';

function ProviderMark({ id }: { id: string }) {
  return (
    <div className="provider-mark">
      <img src={`/providers/${id}.svg`} alt="" />
    </div>
  );
}

export function Environments({
  configured,
  receipts,
  project,
  refresh,
  act,
}: Actions & {
  configured: Record<string, boolean>;
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
      <Heading title="Environments">
        Start on your own computer, or connect a cloud sandbox with a free allowance. Choose the
        environment that fits your work.
      </Heading>
      <section className="environment-card">
        <div className="environment-heading">
          <ProviderMark id="docker" />
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
          <a
            className="text-link"
            href="https://docs.docker.com/get-started/get-docker/"
            target="_blank"
            rel="noreferrer"
          >
            Get Docker <ArrowUpRight size={14} />
          </a>
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
      <div className="environment-grid">
        {clouds.map((cloud) => {
          const saved = !!configured[cloud.id];
          return (
            <section className="environment-card" key={cloud.id} aria-label={cloud.name}>
              <div className="environment-heading">
                <ProviderMark id={cloud.id} />
                <div>
                  <h3>{cloud.name}</h3>
                  <p>
                    {saved ? 'Connection saved · check available' : 'Optional cloud connection'}
                  </p>
                </div>
                <span className="pill">{cloud.offer}</span>
              </div>
              <p>
                <strong>{cloud.allowance}</strong> {cloud.detail}
              </p>
              <div className="provider-links">
                <a className="text-link" href={cloud.signup} target="_blank" rel="noreferrer">
                  Create account <ArrowUpRight size={14} />
                </a>
                <a className="text-link" href={cloud.signin} target="_blank" rel="noreferrer">
                  Sign in <ArrowUpRight size={14} />
                </a>
                <a className="text-link" href={cloud.url} target="_blank" rel="noreferrer">
                  Pricing <ArrowUpRight size={14} />
                </a>
              </div>
              <div className="environment-actions">
                <a className="text-link" href={cloud.dashboard} target="_blank" rel="noreferrer">
                  Open dashboard <ArrowUpRight size={14} />
                </a>
                <button
                  disabled={busy}
                  onClick={() => setEditing(editing === cloud.id ? '' : cloud.id)}
                >
                  {editing === cloud.id
                    ? 'Close setup'
                    : saved
                      ? 'Update connection'
                      : `Connect ${cloud.name}`}
                </button>
              </div>
              {editing === cloud.id && (
                <div className="provider-setup">
                  <ol className="setup-steps">
                    <li>
                      <strong>Sign in with {cloud.name}.</strong> Use the links above;
                      authentication takes place on the provider’s website.
                    </li>
                    <li>
                      <strong>Create a credential.</strong> {cloud.setup}{' '}
                      <a href={cloud.credentialsUrl} target="_blank" rel="noreferrer">
                        Open credentials ↗
                      </a>{' '}
                      ·{' '}
                      <a href={cloud.docs} target="_blank" rel="noreferrer">
                        Setup guide ↗
                      </a>
                    </li>
                    <li>
                      <strong>Save, then check.</strong> Saving stays local. The optional check
                      creates one temporary cloud sandbox.
                    </li>
                  </ol>
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
                        setConsent({ ...consent, [cloud.id]: false });
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
                    <p className="fine">
                      Credentials are encrypted on this computer and never sent back to the browser.
                      Signing in on the provider’s site does not connect A0 SLIM automatically.
                    </p>
                    <button className="primary" disabled={busy}>
                      Save {cloud.name} connection
                    </button>
                  </form>
                </div>
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
              <p className="provider-lifetime">{cloud.lifetime}</p>
            </section>
          );
        })}
      </div>
      <p className="fine">
        Allowances checked October 26, 2026; your provider dashboard is authoritative. Provider
        logos identify integrations and do not imply endorsement. A saved credential is not a
        verified connection; check results and cleanup status appear below.
      </p>
      <div className="list-label">
        Execution receipts <span>{receipts.length}</span>
      </div>
      {!receipts.length && <p className="empty-row">Your first check will appear here.</p>}
      {receipts.map((receipt) => {
        const cloud = clouds.find((c) => receipt.kind === `${c.id}-sandbox-proof`);
        const provider = receipt.kind === 'docker-sandbox' ? 'docker' : cloud?.id;
        return (
          <div className="receipt" key={receipt.id}>
            <div>
              <Check size={16} />
              <strong>
                {provider === 'docker' ? 'Local Docker' : (cloud?.name ?? 'Sandbox')} ·{' '}
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
            {provider && ['unknown', 'stopped'].includes(receipt.cleanup) && (
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
    </>
  );
}
