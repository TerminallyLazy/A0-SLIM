import { z } from 'zod';
import { AppError } from '../domain.js';

export const vercelCredentials = z
  .object({
    token: z.string().trim().min(1).max(8192),
    teamId: z
      .string()
      .trim()
      .regex(
        /^(?:team_[a-zA-Z0-9]+|[a-z0-9]+(?:-[a-z0-9]+)*)$/,
        'Enter a Vercel Team ID or team slug.',
      ),
    projectId: z
      .string()
      .trim()
      .regex(/^prj_[a-zA-Z0-9]+$/, 'Enter the Project ID from Vercel project settings.'),
  })
  .strict();
export type SandboxCredentials = z.infer<typeof vercelCredentials>;

export function vercelFailure(error: unknown): string {
  if (error instanceof AppError) return error.message;
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 401)
    return 'Vercel rejected the access token. Update the connection with a valid token.';
  if (status === 403)
    return 'Vercel denied access. Check that the token can access the selected team and project.';
  if (status === 404)
    return 'Vercel could not find this resource in the selected team and project. A missing response alone does not confirm cleanup.';
  if (status === 400 || status === 422)
    return 'Vercel rejected the request settings. Check the team, project and sandbox configuration.';
  if (status === 402)
    return 'Vercel requires a plan or billing change before this request can run.';
  if (status === 429)
    return 'Vercel rate-limited this request. Check the provider dashboard before retrying.';
  return 'Vercel did not confirm the request. Check the provider dashboard before retrying.';
}

/** Resolve a team slug using this application's token and verify project ownership before any compute. */
export async function verifyVercelScope(
  input: SandboxCredentials,
  transport: typeof fetch = fetch,
): Promise<SandboxCredentials> {
  const credentials = vercelCredentials.parse(input);
  const get = async (url: URL) => {
    const response = await transport(url, {
      headers: { authorization: `Bearer ${credentials.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(400, 'vercel_access', vercelFailure({ response }));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError(502, 'vercel_metadata', 'Vercel returned no project metadata.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 1_048_576)
          throw new AppError(
            502,
            'vercel_metadata',
            'Vercel project metadata exceeded the response limit.',
          );
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString());
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  const query = new URLSearchParams({
    [credentials.teamId.startsWith('team_') ? 'teamId' : 'slug']: credentials.teamId,
  });
  const project = await get(
    new URL(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(credentials.projectId)}?${query}`,
    ),
  );
  if (project.id !== credentials.projectId || !/^team_[a-zA-Z0-9]+$/.test(project.accountId ?? ''))
    throw new AppError(
      409,
      'vercel_scope',
      'Vercel project ownership did not match this connection.',
    );
  if (credentials.teamId.startsWith('team_')) {
    if (project.accountId !== credentials.teamId)
      throw new AppError(409, 'vercel_scope', 'The project belongs to a different Vercel team.');
  }
  // The project endpoint authorizes its documented `slug` scope and returns accountId.
  // Do not require team-management access from a project-scoped token.
  return { ...credentials, teamId: project.accountId };
}
