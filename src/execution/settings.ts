import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
import { AppError } from '../domain.js';
import { defaultSizing, sizingLimits, type SizingProvider, type SandboxSizing } from './sizing.js';

export const sizingProvider = z.enum([
  'vercel',
  'modal',
  'e2b',
  'daytona',
  'microsandbox',
  'docker',
]);
export function parseSizing(provider: SizingProvider, input: unknown): SandboxSizing {
  const limits = sizingLimits[provider];
  const value = z
    .object({
      sessionTimeoutMinutes: z.number().int().min(1).max(limits.maxMinutes),
      vcpus: z.number().refine((v) => limits.cpus.includes(v), 'Choose an available CPU size.'),
      memoryMiB: z
        .number()
        .int()
        .refine((v) => limits.memory.includes(v), 'Choose an available memory size.'),
    })
    .strict()
    .parse(input);
  if (limits.linkedMemory && value.memoryMiB !== value.vcpus * 2048)
    throw new AppError(400, 'sandbox_sizing', 'Vercel requires 2 GB of memory per vCPU.');
  if (
    !limits.sessionTimeout &&
    value.sessionTimeoutMinutes !== defaultSizing[provider].sessionTimeoutMinutes
  )
    throw new AppError(400, 'sandbox_sizing', 'Docker has no separate provider session timeout.');
  return value;
}
export function sandboxSizing(store: Store, provider: SizingProvider): SandboxSizing {
  const saved = store.meta(`sandbox:${provider}:sizing`);
  return saved ? parseSizing(provider, JSON.parse(saved)) : { ...defaultSizing[provider] };
}
export function saveSandboxSizing(store: Store, provider: SizingProvider, input: unknown) {
  const next = parseSizing(provider, input);
  if (JSON.stringify(next) !== JSON.stringify(sandboxSizing(store, provider))) {
    // Invalidate grants first: an interrupted settings write must require fresh acceptance.
    store.setMeta(`sandbox:${provider}:revision`, randomUUID());
    store.setMeta(`sandbox:${provider}:sizing`, JSON.stringify(next));
  }
  return next;
}
