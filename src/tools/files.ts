import { constants } from 'node:fs';
import { lstat, open, realpath, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { FxAgentHostTool } from 'libfx';
import { z } from 'zod';
import { AppError } from '../domain.js';

const pathInput = z.object({ path: z.string().max(2048).default('.') }).strict();
const denied = new Set(['.git', '.env', '.ssh', '.aws', '.a0-slim', 'node_modules']);
export async function workspacePath(root: string, userPath: string) {
  if (isAbsolute(userPath) || userPath.includes('\0'))
    throw new AppError(403, 'outside_workspace', 'Use a relative project path.');
  const base = await realpath(root);
  if (base !== resolve(root))
    throw new AppError(
      403,
      'root_changed',
      'The project folder was replaced by a symlink. Select its current location explicitly.',
    );
  const target = resolve(base, userPath);
  const rel = relative(base, target);
  if (
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    rel
      .split(sep)
      .some((part) => denied.has(part) || part.startsWith('.env.') || part.startsWith('.a0-slim-'))
  ) {
    throw new AppError(403, 'outside_workspace', 'This path is outside the allowed project files.');
  }
  // Reject symlinks throughout the path, not just at the leaf.
  let current = target;
  while (current !== base) {
    if ((await lstat(current)).isSymbolicLink())
      throw new AppError(403, 'symlink_denied', 'Symlinks are not available to project tools.');
    current = dirname(current);
  }
  const canonical = await realpath(target);
  if (canonical !== target)
    throw new AppError(403, 'path_changed', 'Project path changed during access.');
  return { base, target };
}
export async function readWorkspaceFile(root: string, path: string) {
  const { base, target } = await workspacePath(root, path);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024)
      throw new AppError(413, 'file_too_large', 'Choose a regular text file smaller than 256 KiB.');
    const check = await workspacePath(base, path);
    const current = await lstat(check.target);
    if (current.ino !== stat.ino || current.dev !== stat.dev)
      throw new AppError(409, 'path_changed', 'The file changed during access. Try again.');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 256 * 1024)
      throw new AppError(413, 'file_too_large', 'File exceeds the text limit.');
    if (buffer.subarray(0, bytesRead).includes(0))
      throw new AppError(415, 'binary_file', 'This file is not plain text.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
export async function listWorkspace(root: string, path = '.') {
  const { target } = await workspacePath(root, path);
  const entries = await readdir(target, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        !denied.has(entry.name) &&
        !entry.name.startsWith('.env.') &&
        !entry.name.startsWith('.a0-slim-') &&
        !entry.isSymbolicLink(),
    )
    .slice(0, 250)
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
}
export function fileTools(root: string): FxAgentHostTool[] {
  return [
    {
      name: 'list_dir',
      description:
        'List up to 250 entries in an allowed project directory. Symlinks and sensitive directories are excluded.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        additionalProperties: false,
      },
      idempotent: true,
      writes: false,
      execute: (input) => listWorkspace(root, pathInput.parse(input).path),
    },
    {
      name: 'read_file',
      description: 'Read a project text file, at most 256 KiB. Paths are relative to this project.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
      idempotent: true,
      writes: false,
      execute: (input) => readWorkspaceFile(root, pathInput.parse(input).path),
    },
  ];
}
