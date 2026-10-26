/** Opt-in public model download + public Hub metadata; no account credentials or project data. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/storage/store.js';
import { Vault } from '../../src/providers/vault.js';
import { Extensions } from '../../src/extensions/runtime.js';
import { PluginHub } from '../../src/extensions/hub.js';
const dir = await mkdtemp(join(tmpdir(), 'slim-p2-public-')),
  store = new Store(dir),
  ext = new Extensions(store, new Vault(store, async () => Buffer.alloc(32, 9))),
  project = randomUUID();
store.saveProject({ id: project, name: 'Synthetic public check', root: dir });
try {
  const hub = new PluginHub(store);
  await hub.refresh();
  const entry = hub.entry('a0_agent_skills');
  const assessment = await hub.assess(entry.id);
  const path = assessment.skills[0];
  if (!path) throw new Error('No portable skill');
  const skill = await hub.skill(entry.id, path);
  const imported = ext.skills.import(project, { markdown: skill.markdown, source: skill.source });
  ext.skills.change(project, imported.id, 'enable');
  ext.skills.load(project, imported.id, imported.current.digest);
  console.log(
    JSON.stringify({
      hubEntries: hub.catalog()?.entries.length,
      plugin: entry.id,
      revision: entry.commit,
      status: assessment.status,
      portableSkill: path,
      skillDigest: imported.current.digest,
    }),
  );
  ext.embeddings.local.start();
  for (let i = 0; i < 240; i++) {
    const status = await ext.embeddings.local.status();
    if (!['downloading', 'verifying'].includes(status.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const status = await ext.embeddings.local.status();
  if (status.status !== 'ready') throw new Error(JSON.stringify(status));
  const a = await ext.embeddings.local.infer('The garden is green.'),
    b = await ext.embeddings.local.infer('A green garden.');
  console.log(
    JSON.stringify({
      model: status.manifest.id,
      revision: status.manifest.revision,
      status: status.status,
      dimensions: a.length,
      cosine: a.reduce((s, v, i) => s + v * b[i]!, 0),
      runtime: process.version,
      cpu: cpus()[0]?.model,
    }),
  );
  store.db.transaction(() => {
    for (let i = 0; i < 10000; i++)
      ext.memory.save(
        project,
        {
          text: `Synthetic garden note ${i}. Sage green project ${i % 20}.`,
          source: 'Generated benchmark',
        },
        `seed:${i}`,
      );
  })();
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    ext.memory.search(project, `garden ${i}`);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({ benchmark: 'FTS5 100 searches / 10,000 synthetic notes', p95ms: samples[94] }),
  );
} finally {
  await ext.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
}
