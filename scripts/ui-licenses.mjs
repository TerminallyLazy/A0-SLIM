import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const seen = new Set(),
  notices = [];
async function visit(name, parent) {
  const paths = createRequire(parent).resolve.paths(name) ?? [];
  const file = paths.map((p) => join(p, name, 'package.json')).find(existsSync);
  if (!file) throw new Error(`Missing bundled UI dependency ${name}`);
  const path = await realpath(file);
  if (seen.has(path)) return;
  seen.add(path);
  const pkg = JSON.parse(await readFile(path, 'utf8'));
  const dir = dirname(path);
  const licenses = (await readdir(dir))
    .filter((f) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f))
    .sort();
  if (!licenses.length) throw new Error(`Missing license text for bundled ${pkg.name}`);
  notices.push(
    `${pkg.name}@${pkg.version} (${pkg.license ?? 'see below'})\n${(await Promise.all(licenses.map((f) => readFile(join(dir, f), 'utf8')))).join('\n')}`,
  );
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency, path);
}
for (const name of ['react', 'react-dom', 'lucide-react', 'react-markdown', 'remark-gfm'])
  await visit(name, join(root, 'package.json'));
await writeFile(
  join(root, 'dist/ui/THIRD_PARTY_LICENSES.txt'),
  'Licenses for the bundled UI and its dependency graph.\n\n' +
    notices.sort().join('\n\n----------------------------------------\n\n'),
);
