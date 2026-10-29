// SLIM-owned evidence. Upstream catalog fields never grant execution authority.
export const assessmentVersion = 3;
export type Capability = {
  kind: 'tools' | 'skills' | 'lifecycle' | 'ui' | 'services';
  route: 'mcp-adapter' | 'skill-import' | 'agent-zero' | 'native-port';
  detail: string;
};
export type Compatibility = {
  version: number;
  status:
    | 'Verified tools'
    | 'Runs in Agent Zero'
    | 'Skill import available'
    | 'Port required'
    | 'Not assessed';
  reason: string;
  checkedAt: string;
  commit: string;
  skills: string[];
  capabilities: Capability[];
  evidence: 'source';
  adapter?: {
    version: string;
    hostVersion: string;
    operations: string[];
    verified: boolean;
    evidence: string;
    checkedAt: string;
  };
};
const curated: Record<string, { repository: string; commit: string; detail: string }> = {
  db_hub: {
    repository: 'TerminallyLazy/a0-db-hub',
    commit: '9f3b9926cdd815034b0f9f635c60909107d1f2da',
    detail:
      'SLIM plugin worker 0.1.0 runs the original status and schema tools for existing project SQLite files without Agent Zero. Optional runtime download required. The separate Agent Zero 2.14 companion remains available. Other drivers, writes, memory replacement and the workspace UI are separate capabilities.',
  },
  youcom_search: {
    repository: 'brainsparker/a0-youcom-search',
    commit: '2f543aaf28d6db8a7fce29e3e63b2d6a916c5f40',
    detail:
      'Search adapter candidate; requires scoped configuration, secret lookup and an explicit decision about SearXNG fallback.',
  },
  tree_ring_memory: {
    repository: 'TerminallyLazy/tree-ring-memory-agent-zero',
    commit: 'ae4c8c8cab6f30172eb2fb26c27722f38249b615',
    detail:
      'Explicit CLI-backed tools are adapter candidates. Automatic capture and recall need a native lifecycle integration.',
  },
  openui: {
    repository: 'TerminallyLazy/a0-openui',
    commit: '47899892f1b8bc76e2b1a92aebe80a082866da76',
    detail:
      'Uses Agent Zero streaming, logs and browser modules. Interactive cards require a separate SLIM renderer port.',
  },
  selectable_theme: {
    repository: '3clyp50/selectable_theme',
    commit: 'f8fe897bf6a44c706004b7d833b2c9c8de3a7238',
    detail: 'Changes Agent Zero DOM and CSS. A native SLIM theme needs an explicit token port.',
  },
  a0_agent_skills: {
    repository: 'vanja-emichi/a0_agent_skills',
    commit: '239ffe10531eed627e66d4a789c287318aafb78c',
    detail:
      'Skills reference sibling checklists and Agent Zero tool names. Importing instructions omits routing and telemetry hooks.',
  },
  mattpocock_skills: {
    repository: 'MarkoSchuetz/a0-mattpocock-skills',
    commit: '545f789fdce5fced518f6dc19eef16a9a64107f2',
    detail:
      'Installer fetches another repository. Resolve and pin the actual upstream skills; this wrapper revision does not pin them.',
  },
  realtime_voice: {
    repository: 'NoHara42/a0-realtime-voice',
    commit: '4c8b9466c70bed8b1164fea31eb0c1dd3de759da',
    detail:
      'Browser audio and live session ownership require a native voice port or the original Agent Zero UI.',
  },
  mech_calendar: {
    repository: 'twilso24/mech_calendar',
    commit: '4c6678c2f25cfd94d39228c3c57d03fd5151a6b0',
    detail:
      'Scheduled jobs belong to Agent Zero and can outlive a chat. Tool access would not port the scheduler or calendar UI.',
  },
};
export function assessCapabilities(
  entry: { id: string; github: string; commit: string },
  paths: string[],
  incomplete: boolean,
): Compatibility {
  const skills = paths.filter((p) => /(^|\/)SKILL\.md$/.test(p)).slice(0, 40);
  const capabilities: Capability[] = [];
  if (paths.some((p) => /(^|\/)tools\/.*\.py$/.test(p)))
    capabilities.push({
      kind: 'tools',
      route: 'mcp-adapter',
      detail:
        'Requires an explicitly supported adapter; Python tool files alone are not MCP exports.',
    });
  if (skills.length)
    capabilities.push({
      kind: 'skills',
      route: 'skill-import',
      detail:
        'Review individual instructions. Resources, scripts and tool-name mappings need separate review.',
    });
  if (paths.some((p) => /(^|\/)(extensions\/python\/|hooks\.py$)/.test(p)))
    capabilities.push({
      kind: 'lifecycle',
      route: 'agent-zero',
      detail: 'Hooks execute in Agent Zero. Native SLIM behavior requires a separate integration.',
    });
  if (paths.some((p) => /(^|\/)(webui\/|extensions\/webui\/)/.test(p)))
    capabilities.push({
      kind: 'ui',
      route: 'native-port',
      detail: 'Use the original Agent Zero UI; its browser code is not loaded into SLIM.',
    });
  const native = paths.some((p) => p.endsWith('.py'));
  const record = curated[entry.id];
  const matched =
    record?.commit === entry.commit &&
    entry.github.replace(/\/$/, '') === `https://github.com/${record.repository}`;
  const dbAdapter =
    matched &&
    entry.id === 'db_hub' &&
    ['tools/db_status.py', 'tools/db_schema.py'].every((path) => paths.includes(path));
  const status = incomplete
    ? 'Not assessed'
    : dbAdapter
      ? 'Verified tools'
      : native
        ? 'Runs in Agent Zero'
        : capabilities.some((c) => c.kind === 'ui')
          ? 'Port required'
          : skills.length
            ? 'Skill import available'
            : 'Not assessed';
  return {
    version: assessmentVersion,
    status,
    checkedAt: new Date().toISOString(),
    commit: entry.commit,
    skills,
    capabilities: incomplete ? [] : capabilities,
    evidence: 'source',
    reason: incomplete
      ? 'Incomplete source tree; no compatibility claim.'
      : matched
        ? record.detail
        : native
          ? 'Source depends on Python. Agent Zero execution and any native tool adapter require separate runtime verification.'
          : status === 'Port required'
            ? 'Agent Zero UI code needs a native port.'
            : skills.length
              ? 'Instruction files found. Their dependencies and tool references must be reviewed before import.'
              : 'No supported capability identified. Source inspection does not execute this plugin.',
    ...(!incomplete && dbAdapter
      ? {
          adapter: {
            version: '0.1.0',
            hostVersion: '2.14',
            operations: ['db_status', 'db_schema'],
            verified: true,
            evidence:
              'Real DB Hub tools, synthetic SQLite data and synthetic SLIM model; owner-host acceptance is separate. See docs/verification/PLUGIN-COMPANION.md.',
            checkedAt: '2026-10-29',
          },
        }
      : {}),
  };
}
