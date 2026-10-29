import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../install.sh', import.meta.url);
let source = await readFile(path, 'utf8');
for (const [file, delimiter] of [
  ['update.mjs', 'UPDATER'],
  ['managed-launcher.mjs', 'LAUNCHER'],
]) {
  const body = await readFile(new URL(file, import.meta.url), 'utf8');
  if (body.split('\n').includes(delimiter))
    throw new Error(`Reserved installer delimiter: ${delimiter}`);
  const start = source.indexOf(`<<'${delimiter}'\n`);
  const end = source.indexOf(`\n${delimiter}\n`, start);
  if (start < 0 || end < 0) throw new Error(`Missing ${delimiter} installer section`);
  const before = start + `<<'${delimiter}'\n`.length;
  source = source.slice(0, before) + body.trimEnd() + source.slice(end);
}
if (process.argv.includes('--check')) {
  if (source !== (await readFile(path, 'utf8')))
    throw new Error('Run npm run sync:installer before committing updater changes.');
} else await writeFile(path, source);
