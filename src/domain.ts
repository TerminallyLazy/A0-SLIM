import { z } from 'zod';

export const connectionInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['gateway', 'compatible']),
    baseUrl: z.string().max(500).optional(),
    model: z.string().trim().min(1).max(200),
    contextWindow: z.number().int().min(4096).max(2_000_000).default(32768),
    apiKey: z.string().max(8192).optional(),
  })
  .strict();
export type Connection = {
  id: string;
  name: string;
  kind: 'gateway' | 'compatible' | 'chatgpt';
  baseUrl?: string;
  model: string;
  contextWindow: number;
  hasCredential: boolean;
  verifiedAt: string | null;
  account?: { subject: string; clientId: string; label: string };
};
export type Project = {
  id: string;
  name: string;
  root: string;
  execution?: 'none' | 'docker' | 'vercel' | 'microsandbox';
  hostBashGrant?: { revision: string; approvedAt: string };
  vercelGrant?: { revision: string; approvedAt: string };
};
export type Chat = {
  backend?: 'acp';
  id: string;
  title: string;
  projectId: string;
  connectionId: string;
  model: string;
  sessionId: string | null;
  bashVersion?: 1;
  hostBashRevision?: string;
  capabilitiesVersion?: 2;
  delegationVersion?: 1;
  parentChatId?: string;
  rootChatId?: string;
  depth?: number;
  execution?: 'none' | 'docker' | 'vercel' | 'microsandbox';
  executionRevision?: string;
  status: 'idle' | 'running' | 'interrupted';
  lastStop?: string;
  createdAt: string;
};
export type AppEvent = {
  version: 1;
  chatId: string;
  cursor: number;
  event: Record<string, unknown>;
};

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function safeEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(400, 'invalid_endpoint', 'Enter an absolute endpoint URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new AppError(
      400,
      'invalid_endpoint',
      'Use HTTPS, or HTTP on loopback, without credentials or query parameters.',
    );
  }
  return url.href.replace(/\/$/, '');
}
