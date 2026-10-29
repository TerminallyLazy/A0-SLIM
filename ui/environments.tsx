import { BashSettings } from './bash.js';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import type { Project } from '../src/domain.js';
import type { EnvironmentStatus } from '../src/execution/status.js';
import { api } from './api.js';
import { SpaceEnvironment } from './space.js';
import { OpenShellEnvironment } from './openshell.js';
import { ExecutionChoice, type VercelReadiness } from './execution-choice.js';
import { Heading } from './workspace.js';
import { MicrosandboxEnvironment } from './microsandbox.js';
import { SandboxSizingForm } from './sandbox-sizing.js';
import type { MicrosandboxState } from '../src/execution/microsandbox.js';

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
  statuses,
  vercelExecution,
  microsandbox,
  refresh,
  act,
}: Actions & {
  configured: Record<string, boolean>;
  receipts: Record<string, any>[];
  project?: Project;
  statuses: EnvironmentStatus;
  vercelExecution: VercelReadiness;
  microsandbox: MicrosandboxState | null;
}) {
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(''),
    [consent, setConsent] = useState<Record<string, boolean>>({}),
    [vercelConnection, setVercelConnection] = useState<{
      teamId: string;
      projectId: string;
      hasToken: boolean;
    } | null>(null),
    [local, setLocal] = useState<{ available: boolean; message?: string; version?: string } | null>(
      null,
    );
  useEffect(() => {
    void act(async () => setLocal(await api('/sandbox/docker')));
    void act(async () => setVercelConnection(await api('/sandbox/vercel/connection')));
  }, []);
  const perform = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void act(fn).finally(() => setBusy(false));
  };
  const otherReceipts = receipts.filter(
    (r) =>
      r.kind !== 'bash' &&
      r.kind !== 'space-sandbox-proof' &&
      r.kind !== 'openshell-sandbox-proof' &&
      !String(r.kind).startsWith('microsandbox-'),
  );
  return (
    <>
      <Heading title="Environments">
        Use a local microVM, Docker, a cloud sandbox, or a gateway you manage. Connection checks and
        cleanup receipts show what is ready and what needs attention.
      </Heading>
      {project && (
        <ExecutionChoice
          key={project.id}
          project={project}
          dockerAvailable={!!local?.available}
          vercel={vercelExecution}
          microsandbox={microsandbox}
          refresh={refresh}
          act={act}
        />
      )}
      {project && (
        <BashSettings
          key={`bash-${project.id}`}
          project={project}
          receipts={receipts}
          refresh={refresh}
          act={act}
        />
      )}
      <MicrosandboxEnvironment state={microsandbox} refresh={refresh} act={act} />
      <OpenShellEnvironment refresh={refresh} act={act} />
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
          Disposable containers with no network, host-folder mounts or credentials. Node calls allow
          five seconds; Bash allows up to thirty seconds, with bounded output. Local engine
          licensing and electricity are separate.
        </p>
        <SandboxSizingForm provider="docker" refresh={refresh} act={act} />
        <p className="fine">Install Bash support explicitly with this pinned Node Debian image:</p>
        <pre className="setup-command">
          docker pull node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
        </pre>
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
      </section>
      <SpaceEnvironment refresh={refresh} act={act} />
      <div className="environment-grid">
        {clouds.map((cloud) => {
          const saved = !!configured[cloud.id];
          return (
            <section className="environment-card" key={cloud.id} aria-label={cloud.name}>
              <div className="environment-heading">
                <ProviderMark id={cloud.id} />
                <div>
                  <h3>{cloud.name}</h3>
                  <p className="environment-connection" role="status">
                    {statuses[cloud.id]?.activity === 'working'
                      ? 'Checking or cleaning up…'
                      : {
                          not_configured: 'Not connected',
                          unchecked: 'Saved · not verified',
                          changed: 'Settings changed · check again',
                          passed: 'Connection check passed',
                          failed: 'Connection check failed',
                        }[statuses[cloud.id]?.connection ?? 'not_configured']}
                  </p>
                </div>
                <span className="pill">{cloud.offer}</span>
              </div>
              <p className="environment-activity">
                {statuses[cloud.id]?.activity === 'working'
                  ? 'A sandbox operation is in progress.'
                  : statuses[cloud.id]?.activity === 'unknown'
                    ? 'Sandbox state unknown · review cleanup below.'
                    : 'No active sandbox.'}
                {statuses[cloud.id]?.checkedAt && (
                  <> Last check: {new Date(statuses[cloud.id]!.checkedAt!).toLocaleString()}.</>
                )}{' '}
                {cloud.id === 'vercel'
                  ? 'Choose Vercel above for code execution in new chats.'
                  : 'This provider currently supports sandbox tests only.'}
              </p>
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
                  disabled={busy || (cloud.id === 'vercel' && vercelConnection === null)}
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
                        if (cloud.id === 'vercel')
                          setVercelConnection(await api('/sandbox/vercel/connection'));
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
                            required={
                              !(
                                cloud.id === 'vercel' &&
                                field[0] === 'token' &&
                                vercelConnection?.hasToken
                              )
                            }
                            autoComplete="off"
                            placeholder={
                              cloud.id === 'vercel' &&
                              field[0] === 'token' &&
                              vercelConnection?.hasToken
                                ? 'Leave blank to keep the saved token'
                                : undefined
                            }
                            defaultValue={
                              cloud.id === 'vercel' && field[0] !== 'token'
                                ? (vercelConnection?.[field[0] as 'teamId' | 'projectId'] ?? '')
                                : field.length > 3
                                  ? field[3]
                                  : undefined
                            }
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
              <SandboxSizingForm provider={cloud.id} refresh={refresh} act={act} />
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
                    disabled={
                      busy ||
                      !consent[cloud.id] ||
                      receipts.some(
                        (r) => r.kind === `${cloud.id}-sandbox-proof` && r.cleanup === 'unknown',
                      )
                    }
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
        Allowances checked October 28, 2026; your provider dashboard is authoritative. Provider
        logos identify integrations and do not imply endorsement. A saved credential is not a
        verified connection; check results and cleanup status appear below.
      </p>
      <h2>Execution receipts ({otherReceipts.length})</h2>
      {!otherReceipts.length && <p className="empty-row">Your first check will appear here.</p>}
      {otherReceipts.map((receipt) => {
        const cloud = clouds.find(
          (c) =>
            receipt.kind === `${c.id}-sandbox-proof` ||
            (c.id === 'vercel' && receipt.kind === 'vercel-execution'),
        );
        const provider = receipt.kind === 'docker-sandbox' ? 'docker' : cloud?.id;
        return (
          <div className="receipt" key={receipt.id}>
            <div>
              <Check size={16} />
              <strong>
                {provider === 'docker' ? 'Local Docker' : (cloud?.name ?? 'Sandbox')}
                {receipt.kind === 'vercel-execution' ? ' code call' : ''} ·{' '}
                {receipt.status === 'passed'
                  ? 'Completed'
                  : receipt.status === 'pending'
                    ? 'Pending or interrupted'
                    : 'Did not pass'}
              </strong>
              <span className="pill">
                Cleanup:{' '}
                {receipt.cleanup === 'reviewed_absent'
                  ? 'absence reviewed'
                  : receipt.cleanup === 'not_created'
                    ? 'not created'
                    : receipt.cleanup}
              </span>
            </div>
            <p>
              {receipt.environmentId ?? 'No environment created'} ·{' '}
              {new Date(receipt.startedAt).toLocaleString()}
            </p>
            {receipt.message && <p>{receipt.message}</p>}
            {receipt.reconcileMessage && <p className="error">{receipt.reconcileMessage}</p>}
            {receipt.resolution && <p>Provider review: {receipt.resolution}</p>}
            {provider === 'vercel' && receipt.cleanup === 'unknown' && (
              <details>
                <summary>Record a provider review</summary>
                <p>
                  If the sandbox is absent in Vercel, record what you checked. A0 SLIM also verifies
                  project access, an exact-name lookup and the complete sandbox listing. This
                  preserves the failed receipt and releases its hold; it does not mark the original
                  check as passed or claim deletion.
                </p>
                <form
                  className="settings-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    perform(async () => {
                      await api(`/sandbox/vercel/receipts/${receipt.id}/review-absence`, {
                        acknowledgeProviderReview: form.get('acknowledge') === 'on',
                        resolution: String(form.get('resolution') ?? ''),
                      });
                      await refresh();
                    });
                  }}
                >
                  <label>
                    Provider review
                    <textarea name="resolution" required minLength={20} maxLength={2000} />
                  </label>
                  <label className="checkbox">
                    <input name="acknowledge" type="checkbox" required />I checked this exact
                    resource in the original Vercel project and confirmed it is absent.
                  </label>
                  <button disabled={busy}>Record review</button>
                </form>
              </details>
            )}
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
