import { parentPort, workerData } from 'node:worker_threads';
// Block all worker network access before importing the optional inference library.
globalThis.fetch = async () => {
  throw new Error('Network is disabled in the local embedding worker.');
};
const { env, pipeline } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
if (process.argv.includes('--probe')) {
  // Import the native CPU binding too; package presence alone is not runtime readiness.
  const { Tensor } = await import('onnxruntime-node');
  new Tensor('float32', new Float32Array([1]), [1]);
  process.exit(0);
} else {
  env.localModelPath = workerData.directory;
  const extractor = await pipeline('feature-extraction', 'minilm', {
    dtype: 'q8',
    device: 'cpu',
    local_files_only: true,
  });
  parentPort.on('message', async ({ id, text }) => {
    try {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      parentPort.postMessage({ id, vector: Array.from(output.data, Number) });
    } catch {
      parentPort.postMessage({ id, error: 'Local embedding failed.' });
    }
  });
  parentPort.postMessage({ ready: true });
}
