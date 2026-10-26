import { parentPort, workerData } from 'node:worker_threads';
import { env, pipeline } from '@huggingface/transformers';
globalThis.fetch = async () => {
  throw new Error('Network is disabled in the local embedding worker.');
};
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.useFSCache = false;
env.localModelPath = workerData.directory;
// Node CPU inference uses the installed native ONNX runtime. Never fetch WASM or weights.
const extractor = await pipeline('feature-extraction', 'minilm', {
  dtype: 'q8',
  device: 'cpu',
  local_files_only: true,
});
parentPort!.on('message', async ({ id, text }) => {
  try {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    parentPort!.postMessage({ id, vector: Array.from(output.data, Number) });
  } catch {
    parentPort!.postMessage({ id, error: 'Local embedding failed.' });
  }
});
parentPort!.postMessage({ ready: true });
