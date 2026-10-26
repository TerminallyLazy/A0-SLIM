import { ArrowUpRight, GitBranch, Square } from 'lucide-react';
import type { Chat } from '../src/domain.js';
import type { Delegation } from '../src/runtime/delegation.js';
import { Markdown } from './markdown.js';

export type DelegationSummary = Omit<Delegation, 'assignment' | 'inputHash'>;
export function DelegatedTasks({
  chat,
  chats,
  records,
  open,
  stop,
}: {
  chat: Chat;
  chats: Chat[];
  records: DelegationSummary[];
  open: (id: string) => void;
  stop: (id: string) => void;
}) {
  const children = records.filter(
    (record, index) =>
      record.parentChatId === chat.id &&
      !records.slice(0, index).some((later) => later.childChatId === record.childChatId),
  );
  if (!children.length) return null;
  return (
    <section className="delegated-tasks" aria-label="Subordinate tasks">
      <h2>
        <GitBranch size={16} /> Subordinate tasks
      </h2>
      {children.map((record) => {
        const child = chats.find((c) => c.id === record.childChatId);
        const active = ['reserved', 'running'].includes(record.status);
        return (
          <article className="delegated-task" key={record.childChatId}>
            <div className="delegated-task-heading">
              <button className="text-link" onClick={() => open(record.childChatId)}>
                {child?.title ?? 'Subordinate'} <ArrowUpRight size={14} />
              </button>
              <span className="pill" role="status">
                {{
                  reserved: 'Working',
                  running: 'Working',
                  completed: 'Completed',
                  interrupted: 'Interrupted',
                  cancelled: 'Stopped',
                  failed: 'Failed',
                }[record.status]}
              </span>
              {active && (
                <button
                  className="icon"
                  aria-label={`Stop ${child?.title ?? 'subordinate'}`}
                  onClick={() => stop(record.childChatId)}
                >
                  <Square size={13} />
                </button>
              )}
            </div>
            {record.text && (
              <details>
                <summary>Result</summary>
                <Markdown text={record.text} />
              </details>
            )}
            {record.status === 'interrupted' && (
              <p>Review the saved activity before continuing this subordinate from its parent.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}
