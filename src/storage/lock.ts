import Database from 'better-sqlite3';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';

/** An OS-backed SQLite lock is released on process death, with no stale-PID race. */
export function acquireServiceLock(dir: string) {
  const path = join(dir, 'service-lock.db');
  const db = new Database(path, { timeout: 0 });
  chmodSync(path, 0o600);
  try {
    db.exec('BEGIN EXCLUSIVE');
  } catch {
    db.close();
    throw new Error('Another A0 SLIM service is using this data directory.');
  }
  return () => {
    if (db.open) {
      db.exec('ROLLBACK');
      db.close();
    }
  };
}
