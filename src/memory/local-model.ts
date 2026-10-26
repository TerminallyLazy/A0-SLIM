import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, open, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { AppError } from '../domain.js';
import manifest from './local-model.json' with { type: 'json' };
export { manifest as localModelManifest };
export class LocalModel {
  readonly directory: string;
  private worker?: Worker;
  private loading?: Promise<Worker>;
  private abort?: AbortController;
  private job?: Promise<void>;
  private state: { status: string; downloaded: number; error?: string } = {
    status: 'not-downloaded',
    downloaded: 0,
  };
  private serial = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: number[]) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(dataDir: string) {
    this.directory = join(dataDir, 'models', manifest.revision);
  }
  async status() {
    if (
      !this.job &&
      this.state.status === 'not-downloaded' &&
      existsSync(join(this.directory, 'verified.json'))
    ) {
      try {
        const saved = JSON.parse(await readFile(join(this.directory, 'verified.json'), 'utf8'));
        if (saved.revision === manifest.revision)
          this.state = { status: 'ready', downloaded: manifest.bytes };
      } catch {}
    }
    return { ...this.state, manifest, location: this.directory };
  }
  private async valid(file: (typeof manifest.files)[number]) {
    try {
      const bytes = await readFile(join(this.directory, 'minilm', file.path));
      return (
        bytes.length === file.size &&
        createHash('sha256').update(bytes).digest('hex') === file.sha256
      );
    } catch {
      return false;
    }
  }
  start() {
    if (this.job)
      throw new AppError(409, 'download_busy', 'A model download is already in progress.');
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.state = { status: 'downloading', downloaded: 0 };
    this.job = this.download(signal)
      .catch(() => {
        this.state = {
          ...this.state,
          status: signal.aborted ? 'paused' : 'failed',
          error: signal.aborted
            ? 'Download paused. Verified files are kept for resuming.'
            : 'Download or offline verification failed. Retry to reuse verified files.',
        };
      })
      .finally(() => {
        this.job = undefined;
        this.abort = undefined;
      });
  }
  private async download(signal: AbortSignal) {
    for (const file of manifest.files) {
      if (signal.aborted) throw new Error('Cancelled');
      if (await this.valid(file)) {
        this.state.downloaded += file.size;
        continue;
      }
      const target = join(this.directory, 'minilm', file.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const response = await fetch(
        `https://huggingface.co/${manifest.id}/resolve/${manifest.revision}/${file.path}`,
        { signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) },
      );
      if (!response.ok || !response.body) throw new Error('Download failed');
      const reader = response.body.getReader(),
        handle = await open(`${target}.part`, 'w', 0o600),
        hash = createHash('sha256');
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > file.size) throw new Error('Size mismatch');
          hash.update(value);
          await handle.write(value);
          this.state.downloaded += value.byteLength;
        }
        if (bytes !== file.size || hash.digest('hex') !== file.sha256)
          throw new Error('Checksum mismatch');
        await handle.sync();
      } finally {
        await handle.close();
        await reader.cancel().catch(() => {});
      }
      await rename(`${target}.part`, target);
    }
    if (signal.aborted) throw new Error('Cancelled');
    this.state.status = 'verifying';
    await this.stopWorker();
    await this.infer('A0 SLIM offline model verification.');
    if (signal.aborted) throw new Error('Cancelled');
    const handle = await open(join(this.directory, 'verified.json'), 'w', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({
          revision: manifest.revision,
          verifiedAt: new Date().toISOString(),
          dimension: 384,
          runtime: 'transformers.js 4.3.1 CPU',
        }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.state = { status: 'ready', downloaded: manifest.bytes };
  }
  async cancel() {
    this.abort?.abort();
    await this.job;
  }
  private async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      for (const file of manifest.files)
        if (!(await this.valid(file)))
          throw new AppError(409, 'model_missing', 'Download and verify the local model first.');
      const compiled = new URL('./local-worker.js', import.meta.url),
        worker = new Worker(
          existsSync(compiled) ? compiled : new URL('./local-worker.ts', import.meta.url),
          { workerData: { directory: this.directory } },
        );
      worker.on('message', (m) => {
        if (m.id) {
          const p = this.pending.get(m.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.id);
            m.error ? p.reject(new Error(m.error)) : p.resolve(m.vector);
          }
        }
      });
      worker.on('error', () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('Local embedding worker stopped.'));
        }
        this.pending.clear();
        this.worker = undefined;
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Model load timed out')), 60000);
          worker.once('error', (e) => {
            clearTimeout(timer);
            reject(e);
          });
          worker.once('message', (m) => {
            clearTimeout(timer);
            m.ready ? resolve() : reject(new Error('Invalid worker'));
          });
        });
        this.worker = worker;
        return worker;
      } catch (e) {
        await worker.terminate();
        throw e;
      }
    })().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }
  async infer(text: string) {
    const worker = await this.getWorker(),
      id = ++this.serial;
    return new Promise<number[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Local embedding timed out'));
        void this.stopWorker();
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, text });
    });
  }
  private async stopWorker() {
    if (this.loading) await this.loading.catch(() => {});
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await worker.terminate();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Local model unloaded'));
    }
    this.pending.clear();
  }
  async remove() {
    await this.cancel();
    await this.stopWorker();
    await rm(this.directory, { recursive: true, force: true });
    this.state = { status: 'not-downloaded', downloaded: 0 };
  }
  async close() {
    await this.cancel();
    await this.stopWorker();
  }
}
