import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Store } from '../storage/store.js';
import { AppError } from '../domain.js';

const exec = promisify(execFile);
export type KeySource = () => Promise<Buffer>;

export function systemKeySource(dataDir: string): KeySource {
  let pending: Promise<Buffer> | undefined;
  return () =>
    (pending ??= (async () => {
      if (process.env.A0_SLIM_VAULT_KEY) {
        const key = Buffer.from(process.env.A0_SLIM_VAULT_KEY, 'base64');
        if (key.length !== 32)
          throw new AppError(
            503,
            'vault_unavailable',
            'A0_SLIM_VAULT_KEY must contain a base64-encoded 32-byte key.',
          );
        return key;
      }
      if (process.platform !== 'darwin')
        throw new AppError(
          503,
          'vault_unavailable',
          'Set A0_SLIM_VAULT_KEY in your environment before saving credentials. An OS keychain adapter is currently available on macOS.',
        );
      const service = `io.a0-slim.vault.${createHash('sha256').update(dataDir).digest('hex').slice(0, 16)}`;
      try {
        const { stdout } = await exec(
          '/usr/bin/security',
          ['find-generic-password', '-s', service, '-a', 'a0-slim', '-w'],
          { timeout: 15_000 },
        );
        const key = Buffer.from(stdout.trim(), 'base64');
        if (key.length !== 32) throw new Error('Invalid vault key');
        return key;
      } catch (error) {
        if ((error as { code?: number }).code !== 44)
          throw new AppError(
            503,
            'vault_unavailable',
            'The system keychain could not unlock this application’s vault.',
          );
      }
      const key = randomBytes(32);
      // Send the new app-owned key through stdin, never process arguments or logs.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'ignore', 'ignore'] });
        const timeout = setTimeout(() => {
          child.kill();
          reject(new AppError(503, 'vault_unavailable', 'Keychain setup timed out.'));
        }, 15_000);
        child.once('error', () => {
          clearTimeout(timeout);
          reject(new AppError(503, 'vault_unavailable', 'Keychain setup failed.'));
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else reject(new AppError(503, 'vault_unavailable', 'Keychain setup was not accepted.'));
        });
        child.stdin.end(
          `add-generic-password -s "${service}" -a "a0-slim" -w "${key.toString('base64')}"\n`,
        );
      });
      // Read back to verify that the keychain actually accepted the command.
      const { stdout } = await exec(
        '/usr/bin/security',
        ['find-generic-password', '-s', service, '-a', 'a0-slim', '-w'],
        { timeout: 15_000 },
      );
      if (stdout.trim() !== key.toString('base64'))
        throw new AppError(503, 'vault_unavailable', 'Could not verify the application vault key.');
      return key;
    })().catch((error) => {
      pending = undefined;
      throw error;
    }));
}

export class Vault {
  constructor(
    private store: Store,
    private keySource: KeySource,
  ) {}
  async set(id: string, value: unknown) {
    const key = await this.keySource();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(id));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const ciphertext = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    });
    this.store.db.prepare('INSERT OR REPLACE INTO vault VALUES (?,?)').run(id, ciphertext);
  }
  async get<T>(id: string): Promise<T | null> {
    const row = this.store.db.prepare('SELECT ciphertext FROM vault WHERE id=?').get(id) as
      { ciphertext: string } | undefined;
    if (!row) return null;
    try {
      const value = JSON.parse(row.ciphertext);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.keySource(),
        Buffer.from(value.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(id));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(value.data, 'base64')),
          decipher.final(),
        ]).toString(),
      ) as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'vault_unavailable',
        'Stored credentials could not be decrypted. Restore the correct vault key.',
      );
    }
  }
  remove(id: string) {
    this.store.db.prepare('DELETE FROM vault WHERE id=?').run(id);
  }
}
