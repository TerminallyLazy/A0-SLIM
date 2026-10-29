import { useState } from 'react';
import type { Project } from '../src/domain.js';
import type { AccessDecision, AccessMode } from '../src/policy/access.js';
import { api } from './api.js';
const choices: { value: AccessMode; name: string; description: string }[] = [
  {
    value: 'full',
    name: 'Full Access',
    description: 'Unrestricted access to the internet and any files on the computer.',
  },
  {
    value: 'auto',
    name: 'Approve for me',
    description: 'Only ask for actions detected as potentially unsafe.',
  },
  {
    value: 'ask',
    name: 'Ask for Approval',
    description: 'Always ask to edit external files and use the internet.',
  },
];
export function AccessPicker({
  project,
  refresh,
  act,
  compact = false,
  onBusyChange,
}: {
  project: Project;
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  compact?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const choice = choices.find((c) => c.value === project.access?.mode);
  return (
    <div className={`access-picker ${compact ? 'compact' : ''}`}>
      <label>
        Access{' '}
        <select
          aria-label="Access mode"
          value={project.access?.mode ?? ''}
          disabled={busy}
          title={
            choice?.description ??
            'Choose an access mode. Existing permissions are retained until you choose.'
          }
          onChange={(e) => {
            const mode = e.target.value;
            setBusy(true);
            onBusyChange?.(true);
            void act(async () => {
              await api(`/projects/${project.id}/access`, { mode });
              await refresh();
            }).finally(() => {
              setBusy(false);
              onBusyChange?.(false);
            });
          }}
        >
          {!project.access && (
            <option value="" disabled>
              Current permissions
            </option>
          )}
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {!compact && (
        <p className="fine">
          {choice?.description ??
            'Choose a mode to use the updated tools. Existing permissions remain in effect.'}{' '}
          {project.access?.mode === 'full' && 'Uses your OS account permissions.'} Changing access
          stops the current turn.
        </p>
      )}
    </div>
  );
}
export function AccessApprovals({
  decisions,
  chatId,
  act,
  refresh,
}: {
  decisions: AccessDecision[];
  chatId?: string;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string>();
  return (
    <>
      {decisions
        .filter((d) => d.chatId === chatId && d.status === 'pending')
        .map((d) => (
          <section className="access-approval" key={d.id} aria-label="Action approval">
            <h3>{d.action.title}</h3>
            <p className="wrap">{d.action.target}</p>
            <p>{d.reason}</p>
            {d.action.details && (
              <details>
                <summary>
                  {d.action.kind === 'write' ? 'Review file changes' : 'Review arguments'}
                </summary>
                <pre>{d.action.details}</pre>
              </details>
            )}
            <div className="button-row">
              {[true, false].map((allow) => (
                <button
                  type="button"
                  className={allow ? 'primary' : ''}
                  disabled={!!busy}
                  key={String(allow)}
                  onClick={() => {
                    setBusy(d.id);
                    void act(async () => {
                      await api(`/access-decisions/${d.id}`, { digest: d.digest, allow });
                      await refresh();
                    }).finally(() => setBusy(undefined));
                  }}
                >
                  {allow ? 'Approve once' : 'Deny'}
                </button>
              ))}
            </div>
            <small>The agent continues after your decision.</small>
          </section>
        ))}
    </>
  );
}
