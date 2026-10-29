import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import { digest, parseSkill } from './skills.js';
import { assessCapabilities, assessmentVersion, type Compatibility } from './compatibility.js';
export const HUB_URL =
  'https://github.com/agent0ai/a0-plugins/releases/download/generated-index/index.json';
export type HubEntry = {
  id: string;
  title: string;
  description: string;
  github: string;
  commit: string;
  version: string;
  tags: string[];
  assessment?: Compatibility;
};
export type HubCatalog = { entries: HubEntry[]; fetchedAt: string; digest: string; source: string };
const repo = z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/);
const row = z.object({
  title: z.string().max(200),
  description: z.string().max(5000).default(''),
  github: repo,
  commit: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional()
    .default(''),
  version: z.string().max(100).default(''),
  tags: z
    .array(z.string().max(80))
    .max(40)
    .nullish()
    .transform((v) => v ?? []),
});
export async function boundedFetch(url: string, max = 2_000_000, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'A0-SLIM', accept: 'application/json' },
    signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok || !response.body)
    throw new AppError(
      502,
      'source_unavailable',
      'The upstream source is unavailable. The last good catalog is preserved.',
    );
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max)
        throw new AppError(413, 'source_size', 'Upstream response exceeds the supported size.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
export class PluginHub {
  private generation = 0;
  constructor(
    private store: Store,
    private read: typeof boundedFetch = boundedFetch,
  ) {}
  catalog(): HubCatalog | null {
    const catalog = JSON.parse(this.store.meta('hub:catalog') ?? 'null') as HubCatalog | null;
    for (const entry of catalog?.entries ?? [])
      if (entry.assessment?.version !== assessmentVersion) delete entry.assessment;
    return catalog;
  }
  async refresh() {
    const generation = ++this.generation,
      raw = JSON.parse(await this.read(HUB_URL));
    const plugins = z.record(z.string().max(100), row).parse(raw.plugins);
    if (Object.keys(plugins).length > 2000)
      throw new AppError(413, 'hub_size', 'Catalog has too many entries.');
    const old = this.catalog();
    const entries = Object.entries(plugins).map(([id, item]) => {
      const assessment = old?.entries.find(
        (e) => e.id === id && e.commit === item.commit && e.github === item.github,
      )?.assessment;
      return { id, ...item, ...(assessment ? { assessment } : {}) };
    });
    const catalog: HubCatalog = {
      entries,
      fetchedAt: new Date().toISOString(),
      digest: digest(entries),
      source: HUB_URL,
    };
    if (generation === this.generation) this.store.setMeta('hub:catalog', JSON.stringify(catalog));
    return this.catalog();
  }
  entry(id: string) {
    const entry = this.catalog()?.entries.find((e) => e.id === id);
    if (!entry) throw new AppError(404, 'hub_missing', 'Refresh the catalog and choose an entry.');
    return entry;
  }
  async assess(id: string) {
    const entry = this.entry(id);
    if (!entry.commit)
      throw new AppError(
        409,
        'hub_unpinned',
        'This entry has no pinned source commit. Compatibility remains unknown.',
      );
    const repo = entry.github.replace('https://github.com/', '').replace(/\/$/, '');
    const tree = z
      .object({
        truncated: z.boolean().optional(),
        tree: z.array(z.object({ path: z.string().max(1000), type: z.string() })).max(20000),
      })
      .parse(
        JSON.parse(
          await this.read(
            `https://api.github.com/repos/${repo}/git/trees/${entry.commit}?recursive=1`,
            4_000_000,
          ),
        ),
      );
    const paths = tree.tree.filter((f) => f.type === 'blob').map((f) => f.path);
    const assessment = assessCapabilities(entry, paths, !!tree.truncated);
    const current = this.catalog();
    if (current) {
      const index = current.entries.findIndex(
        (e) => e.id === id && e.commit === entry.commit && e.github === entry.github,
      );
      if (index >= 0) {
        current.entries[index] = { ...current.entries[index]!, assessment };
        this.store.setMeta('hub:catalog', JSON.stringify(current));
      }
    }
    return assessment;
  }
  async skill(id: string, path: string) {
    const entry = this.entry(id);
    if (entry.assessment?.commit !== entry.commit || !entry.assessment.skills.includes(path))
      throw new AppError(409, 'hub_revision', 'Assess the current revision first.');
    const repo = entry.github.replace('https://github.com/', '').replace(/\/$/, '');
    const url = `https://raw.githubusercontent.com/${repo}/${entry.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const markdown = await this.read(url, 32000);
    parseSkill(markdown);
    return {
      markdown,
      source: url,
      revision: entry.commit,
      warnings: [
        'Only this Markdown file is imported. Referenced resources, scripts, commands and Agent Zero tool names are not made available automatically. Review and adapt them before enabling.',
      ],
    };
  }
}
