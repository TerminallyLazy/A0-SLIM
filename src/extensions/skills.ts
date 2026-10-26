import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';

export const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type SkillRevision = {
  markdown: string;
  digest: string;
  importedAt: string;
  source: string;
};
export type Skill = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  enabled: boolean;
  current: SkillRevision;
  previous?: SkillRevision;
};
export const skillInput = z
  .object({
    markdown: z.string().min(1).max(32000),
    source: z.string().max(500).default('User import'),
    id: z.string().uuid().optional(),
  })
  .strict();
export function parseSkill(markdown: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match)
    throw new AppError(
      400,
      'skill_format',
      'SKILL.md needs YAML frontmatter with name and description.',
    );
  const doc = parseDocument(match[1]!, { schema: 'core' });
  if (doc.errors.length)
    throw new AppError(400, 'skill_format', 'The skill frontmatter is invalid.');
  const meta = z
    .object({
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().min(1).max(1000),
    })
    .parse(doc.toJS({ maxAliasCount: 0 }));
  if (!markdown.slice(match[0].length).trim())
    throw new AppError(400, 'skill_empty', 'Include instructions after the frontmatter.');
  return meta;
}
export class Skills {
  constructor(private store: Store) {}
  list(projectId: string) {
    this.store.project(projectId);
    return this.store.records<Skill>('skill').filter((s) => s.projectId === projectId);
  }
  get(projectId: string, id: string) {
    const skill = this.list(projectId).find((s) => s.id === id);
    if (!skill) throw new AppError(404, 'skill_missing', 'Skill not found in this project.');
    return skill;
  }
  import(projectId: string, raw: unknown) {
    const input = skillInput.parse(raw),
      meta = parseSkill(input.markdown);
    const list = this.list(projectId),
      prior = input.id ? this.get(projectId, input.id) : undefined;
    if (!prior && list.length >= 100)
      throw new AppError(400, 'skill_limit', 'This project already has 100 skills.');
    const value: Skill = {
      id: prior?.id ?? randomUUID(),
      projectId,
      ...meta,
      enabled: false,
      current: {
        markdown: input.markdown,
        digest: digest(input.markdown),
        source: input.source,
        importedAt: new Date().toISOString(),
      },
      ...(prior ? { previous: prior.current } : {}),
    };
    this.store.record('skill', value);
    return value;
  }
  change(projectId: string, id: string, action: 'enable' | 'disable' | 'rollback' | 'delete') {
    const skill = this.get(projectId, id);
    if (action === 'delete') {
      this.store.removeRecord('skill', id);
      return;
    }
    if (action === 'rollback') {
      if (!skill.previous)
        throw new AppError(400, 'no_revision', 'No earlier revision is available.');
      const previous = skill.current;
      skill.current = skill.previous;
      skill.previous = previous;
      Object.assign(skill, parseSkill(skill.current.markdown));
      skill.enabled = false;
    } else {
      if (
        action === 'enable' &&
        this.list(projectId).filter((s) => s.enabled && s.id !== id).length >= 20
      )
        throw new AppError(400, 'skill_limit', 'Enable at most 20 skills per project.');
      skill.enabled = action === 'enable';
    }
    this.store.record('skill', skill);
    return skill;
  }
  active(projectId: string) {
    return this.list(projectId)
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        digest: s.current.digest,
      }));
  }
  load(projectId: string, id: string, hash: string) {
    const skill = this.get(projectId, id);
    if (!skill.enabled || skill.current.digest !== hash)
      throw new AppError(
        409,
        'skill_changed',
        'Skill permission or revision changed. Use the next turn’s catalog.',
      );
    return {
      name: skill.name,
      source: skill.current.source,
      revision: hash,
      instructions: skill.current.markdown,
      boundary:
        'User-enabled task guidance. This grants no tools, scripts, network access, or additional permissions. Resources are not imported.',
    };
  }
}
