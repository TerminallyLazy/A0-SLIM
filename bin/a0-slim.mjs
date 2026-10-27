#!/usr/bin/env node
import { createRequire } from 'node:module';
if (Number(process.versions.node.split('.')[0]) !== 24)
  throw new Error('A0 SLIM requires Node 24.');
if (process.argv.includes('--help')) {
  console.log(
    'A0 SLIM\n\nUsage: a0-slim [--no-open]\n\nStarts the native SLIM agent and opens the local browser workspace at http://127.0.0.1:4310.\nFirst run: pair the browser, connect a model and choose a workspace. No Agent Zero installation is required.\nOptional local embeddings: Memory → Embeddings & models → Install local embeddings.\nOptional local microVMs: Environments → Microsandbox → Install Microsandbox.\nEnvironment: A0_SLIM_PORT, A0_SLIM_DATA_DIR',
  );
} else {
  // Also handle npm versions that do not run dependency install scripts by default.
  // Exact source hashes prevent loading an unreviewed runtime or applying this patch twice.
  createRequire(import.meta.url)('../scripts/patch-libfx.cjs');
  await import('../dist/server/cli.js');
}
