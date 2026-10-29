import { useEffect, useState } from 'react';
import type { MicrosandboxState } from '../src/execution/microsandbox.js';
import { api } from './api.js';
import { SandboxSizingForm } from './sandbox-sizing.js';

export function MicrosandboxEnvironment({
  state,
  refresh,
  act,
}: {
  state: MicrosandboxState | null;
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [download, setDownload] = useState(false),
    [reviewId, setReviewId] = useState(''),
    [resolution, setResolution] = useState('');
  const installing = state?.runtime.status === 'installing';
  useEffect(() => {
    if (!installing && state?.activity !== 'working') return;
    const timer = setInterval(() => void act(refresh), 2000);
    return () => clearInterval(timer);
  }, [installing, state?.activity]);
  const perform = (path: string, body: unknown = {}) => {
    setBusy(true);
    void act(async () => {
      try {
        await api(`/sandbox/microsandbox/${path}`, body);
      } finally {
        await refresh();
      }
    }).finally(() => setBusy(false));
  };
  const installed = state?.runtime.status === 'installed';
  const working = busy || installing || state?.activity === 'working';
  const held = state?.receipts.some((r) => r.cleanup === 'unknown');
  const label = installing
    ? 'Installing runtime and image'
    : state?.activity === 'working'
      ? 'Sandbox operation in progress'
      : held
        ? 'Recovery required'
        : state?.available
          ? 'Ready · no active sandbox'
          : installed
            ? 'Check required'
            : 'Setup required';
  return (
    <section className="environment-card" aria-label="Microsandbox">
      <div className="environment-heading">
        <div className="provider-mark">
          <img src="/providers/microsandbox.png" alt="" />
        </div>
        <div>
          <h3>Microsandbox</h3>
          <p>Local microVMs · no Docker or account required</p>
        </div>
        <span className="pill" role="status">
          {label}
        </span>
      </div>
      <p>
        Run Node.js or Bash in a temporary virtual machine on your computer. Guest networking is
        disabled; project folders and model credentials are not mounted. Node calls allow five
        seconds; Bash allows up to thirty seconds. Choose the VM resources and maximum session
        lifetime below; the default is 15 minutes.
      </p>
      <SandboxSizingForm provider="microsandbox" refresh={refresh} act={act} />
      {!installed && (
        <>
          <p>
            Install Microsandbox 0.7.11 and a pinned Node image. The native package uses about 96 MB
            on Apple Silicon, plus the image and runtime cache. Downloads are separate from SLIM’s
            core package. Apple Silicon macOS or Linux with KVM is required.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={download}
              disabled={!!working}
              onChange={(e) => setDownload(e.target.checked)}
            />
            Download the optional runtime and Node image to this computer.
          </label>
        </>
      )}
      {state?.runtime.error && <p role="alert">{state.runtime.error}</p>}
      {state?.connection?.message && <p role="alert">{state.connection.message}</p>}
      {installed && state?.reason && <p>{state.reason}</p>}
      <div className="environment-actions">
        {installing && (
          <button disabled={busy} onClick={() => perform('cancel-setup')}>
            Cancel setup
          </button>
        )}
        {!installed && (
          <button
            disabled={!!working || !download || !state?.runtime.supported || !!held}
            onClick={() => perform('install', { acknowledgeDownload: true })}
          >
            Install Microsandbox
          </button>
        )}
        <button disabled={!!working || !installed} onClick={() => perform('check')}>
          Check runtime
        </button>
        <button disabled={!!working || !installed || !!held} onClick={() => perform('proof')}>
          Run local sandbox check
        </button>
        <a
          className="text-link"
          href="https://docs.microsandbox.dev/getting-started/introduction"
          target="_blank"
          rel="noreferrer"
        >
          Setup documentation
        </a>
      </div>
      <p className="fine">
        The local check creates one VM, writes and reads a synthetic note, then verifies deletion.
        No model request is made. Choose Microsandbox for new chats after the check passes.
      </p>
      {state?.connection?.checkedAt && (
        <p className="fine">
          Runtime checked {new Date(state.connection.checkedAt).toLocaleString()}.
        </p>
      )}
      {!!state?.receipts.length && (
        <details>
          <summary>Microsandbox receipts ({state.receipts.length})</summary>
          {state.receipts.slice(0, 20).map((r) => (
            <div className="provider-setup" key={r.id}>
              <strong>
                {r.kind === 'microsandbox-proof' ? 'Local check' : 'Code execution'} · {r.status}
              </strong>
              <p>
                {r.cleanup === 'deleted'
                  ? 'No active sandbox · cleanup complete'
                  : 'Sandbox outcome unknown · recovery required'}
              </p>
              <p className="fine">
                {new Date(r.startedAt).toLocaleString()} · {r.name}
              </p>
              {r.message && <p>{r.message}</p>}
              {r.cleanupMessage && <p>{r.cleanupMessage}</p>}
              {r.cleanup === 'unknown' && (
                <div className="environment-actions">
                  <button
                    disabled={!!working || !state.runtime.recoveryAvailable}
                    onClick={() => perform(`receipts/${r.id}/reconcile`)}
                  >
                    Recheck and remove
                  </button>
                  {!r.sandboxId && (
                    <button
                      disabled={!!working || !state.runtime.recoveryAvailable}
                      onClick={() => {
                        setReviewId(r.id);
                        setResolution('');
                      }}
                    >
                      Review absent sandbox
                    </button>
                  )}
                </div>
              )}
              {reviewId === r.id && r.cleanup === 'unknown' && (
                <div>
                  <p>
                    After two minutes, inspect the runtime directory and confirm no creation process
                    or VM remains for this exact name. Describe your review. SLIM checks absence
                    again and preserves the failed execution receipt.
                  </p>
                  <label>
                    Review notes
                    <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
                  </label>
                  <button
                    disabled={!!working || resolution.trim().length < 20}
                    onClick={() =>
                      perform(`receipts/${r.id}/review-absence`, {
                        acknowledgeReview: true,
                        resolution,
                      })
                    }
                  >
                    Record absence review
                  </button>
                </div>
              )}
            </div>
          ))}
        </details>
      )}
      {installed && (
        <details>
          <summary>Runtime storage and removal</summary>
          <p className="fine">
            Runtime: {state.runtime.location}
            <br />
            Images and VM records: {state.runtime.runtimeHome}
          </p>
          <p>
            Removing the add-on disables future execution. Cached images and VM records are retained
            for inspection.
          </p>
          <button disabled={!!working || !!held} onClick={() => perform('remove')}>
            Remove optional runtime
          </button>
        </details>
      )}
    </section>
  );
}
