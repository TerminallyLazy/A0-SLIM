import { constants } from 'node:fs';
import { lstat, open, realpath, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FxAgentHostTool } from 'libfx';
import { z } from 'zod';
import type { Access } from '../policy/access.js';
import { AppError } from '../domain.js';
export async function accessPath(root: string, path: string, create = false) {
  if (path.includes('\0')) throw new AppError(400, 'path_invalid', 'Invalid file path.');
  const requested = resolve(root, path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
  let target: string;
  try {
    target = await realpath(requested);
  } catch (e: any) {
    if (!create || e.code !== 'ENOENT') throw e;
    // A broken symlink must never become an implicit replacement.
    try {
      await lstat(requested);
      throw new AppError(409, 'path_invalid', 'The target is a broken link.');
    } catch (statError: any) {
      if (statError.code !== 'ENOENT') throw statError;
    }
    target = join(await realpath(dirname(requested)), basename(requested));
  }
  const base = await realpath(root),
    rel = relative(base, target);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const sensitive =
    (outside ? target : join(basename(base), rel))
      .split(sep)
      .some((p) => /^\.(env($|\.)|ssh$|aws$|git$|a0-slim|codex$|config$)/.test(p)) ||
    /(^|\/)(\.\w*rc|\.\w*profile)$/.test(target);
  return { target, parent: dirname(target), path: target, outside, sensitive };
}
export async function readAccessFile(target: string) {
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    const current = await lstat(target);
    if ((await realpath(target)) !== target || current.ino !== stat.ino || current.dev !== stat.dev)
      throw new AppError(409, 'path_changed', 'The file changed during access.');
    if (!stat.isFile() || stat.size > 256 * 1024)
      throw new AppError(413, 'file_size', 'Choose a regular text file smaller than 256 KiB.');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 256 * 1024 || buffer.subarray(0, bytesRead).includes(0))
      throw new AppError(413, 'file_size', 'Choose a regular text file smaller than 256 KiB.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
export function accessFileTools(
  projectId: string,
  root: string,
  access: Access,
): FxAgentHostTool[] {
  return ['read_file', 'list_dir'].map((name) => ({
    name,
    description:
      name === 'read_file'
        ? 'Read a text file (up to 256 KiB). Relative project paths, absolute paths and ~/ are supported under the selected access mode.'
        : 'List up to 250 directory entries under the selected access mode.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    idempotent: true,
    writes: false,
    execute: async (input, ctx) => {
      const { path } = z
        .object({ path: z.string().max(2048) })
        .strict()
        .parse(input);
      const original = await accessPath(root, path);
      const check = await access.authorize(access.context(projectId, ctx), {
        kind: 'read',
        title: name === 'read_file' ? 'Read file' : 'List directory',
        target: original.target,
        outside: original.outside,
        sensitive: original.sensitive,
      });
      const current = await accessPath(root, path);
      if (current.target !== original.target)
        throw new AppError(409, 'path_changed', 'The path changed after approval.');
      check();
      if (name === 'read_file') return readAccessFile(current.target);
      return (await readdir(current.target, { withFileTypes: true })).slice(0, 250).map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'link' : 'file',
      }));
    },
  }));
}
