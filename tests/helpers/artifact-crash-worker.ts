import { Store } from '../../src/storage/store.js';
import { Operations } from '../../src/policy/operations.js';
const [dir, id, digest] = process.argv.slice(2) as [string, string, string];
const store = new Store(dir);
const operations = new Operations(store, async () => {
  process.send?.({ type: 'written' });
  await new Promise(() => {});
});
void operations.apply(id, digest);
