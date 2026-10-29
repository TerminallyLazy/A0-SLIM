import { useEffect, useState } from 'react';
import { api } from './api.js';
import {
  defaultSizing,
  sizingLimits,
  type SizingProvider,
  type SandboxSizing,
} from '../src/execution/sizing.js';

export function SandboxSizingForm({
  provider,
  refresh,
  act,
}: {
  provider: SizingProvider;
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [value, setValue] = useState<SandboxSizing>(defaultSizing[provider]);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const limits = sizingLimits[provider];
  useEffect(() => {
    void act(async () => {
      setValue(await api(`/sandbox/${provider}/sizing`));
      setLoaded(true);
    });
  }, [provider]);
  return (
    <form
      className="settings-form sandbox-sizing"
      aria-label={`${provider} sandbox resources`}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setNotice('');
        void act(async () => {
          setValue(await api(`/sandbox/${provider}/sizing`, value));
          setNotice(
            provider === 'docker'
              ? 'Sandbox settings saved for subsequent calls.'
              : 'Sandbox settings saved. Run the connection check again before starting a new chat.',
          );
          await refresh();
        }).finally(() => setBusy(false));
      }}
    >
      <div className="form-grid">
        {limits.sessionTimeout && (
          <label>
            Session timeout (minutes)
            <input
              type="number"
              min={1}
              max={limits.maxMinutes}
              step={1}
              required
              value={Number.isNaN(value.sessionTimeoutMinutes) ? '' : value.sessionTimeoutMinutes}
              onChange={(e) =>
                setValue({ ...value, sessionTimeoutMinutes: e.target.valueAsNumber })
              }
            />
          </label>
        )}
        <label>
          vCPUs
          <select
            disabled={limits.cpus.length === 1}
            value={value.vcpus}
            onChange={(e) => {
              const vcpus = Number(e.target.value);
              setValue({
                ...value,
                vcpus,
                ...(limits.linkedMemory ? { memoryMiB: vcpus * 2048 } : {}),
              });
            }}
          >
            {limits.cpus.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Memory
          <select
            disabled={limits.memory.length === 1}
            value={value.memoryMiB}
            onChange={(e) => {
              const memoryMiB = Number(e.target.value);
              setValue({
                ...value,
                memoryMiB,
                ...(limits.linkedMemory ? { vcpus: memoryMiB / 2048 } : {}),
              });
            }}
          >
            {limits.memory.map((n) => (
              <option key={n} value={n}>
                {n >= 1024 ? `${n / 1024} ${provider === 'vercel' ? 'GB' : 'GiB'}` : `${n} MiB`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="fine">{limits.note}</p>
      {limits.sessionTimeout && (
        <p className="fine">
          Maximum sandbox lifetime: {limits.maxMinutes} minutes. The sandbox is cleaned up when its
          call finishes; individual command limits still apply.
        </p>
      )}
      <button disabled={!loaded || busy}>Save sandbox settings</button>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
