/** Opt-in local model for one approved live Vercel chat check. This script alone uses no cloud. */
import { startModelFixture } from './model-server.js';
const model = await startModelFixture({
  tool: 'run_javascript',
  toolInput: {
    code: "process.stdout.write(require('node:fs').readFileSync(0,'utf8').toUpperCase()+String(6*7)+'\\n')",
    input: 'A0 SLIM Vercel execution check\n',
  },
  maxRequests: 2,
});
console.log(
  JSON.stringify({
    name: 'Vercel acceptance · local test model',
    kind: 'compatible',
    model: 'fixture',
    baseUrl: model.url,
    apiKeyRequired: false,
    expectedOutput: 'A0 SLIM VERCEL EXECUTION CHECK\n42\n',
    instruction:
      'Use only in a synthetic project after approval for one Vercel call. Revoke that project grant when the check finishes.',
  }),
);
const stop = async () => {
  await model.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
