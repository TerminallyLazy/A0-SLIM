export type SandboxProvider = {
  id: 'vercel' | 'modal' | 'e2b' | 'daytona';
  name: string;
  offer: string;
  allowance: string;
  detail: string;
  url: string;
  signup: string;
  signin: string;
  dashboard: string;
  credentialsUrl: string;
  docs: string;
  setup: string;
  lifetime: string;
  fields: readonly (readonly [string, string, boolean, string?])[];
};

/** Public provider metadata only. Credentials and lifecycle adapters stay on the local server. */
export const sandboxProviders: readonly SandboxProvider[] = [
  {
    id: 'vercel',
    name: 'Vercel Sandbox',
    offer: 'Monthly allowance',
    allowance: 'Hobby: 5 CPU hours, 420 GB-hours of memory and 5,000 creations per month.',
    detail: 'Hobby pauses new creation at its quota. Paid plans can incur usage charges.',
    url: 'https://vercel.com/docs/sandbox/pricing',
    signup: 'https://vercel.com/signup',
    signin: 'https://vercel.com/login',
    dashboard: 'https://vercel.com/dashboard',
    credentialsUrl: 'https://vercel.com/account/settings/tokens',
    docs: 'https://vercel.com/docs/sandbox/concepts/authentication',
    setup:
      'Create an access token for the team that owns your Vercel project. Enter its Team ID (team_…) or team slug and the Project ID (prj_…) from project settings. A0 SLIM verifies ownership and resolves the team ID before creating a sandbox.',
    lifetime:
      '60-second lifetime · outbound network denied · stopped, then deleted during reconciliation.',
    fields: [
      ['teamId', 'Team ID or slug', false],
      ['projectId', 'Project ID', false],
      ['token', 'Access token', true],
    ],
  },
  {
    id: 'modal',
    name: 'Modal',
    offer: 'Monthly credit',
    allowance: 'Starter: $30 in free compute credit every month.',
    detail: 'Shared across Modal compute. Usage beyond the allowance may be billed.',
    url: 'https://modal.com/pricing',
    signup: 'https://modal.com/signup?next=%2Fapps',
    signin: 'https://modal.com/login?next=%2Fapps',
    dashboard: 'https://modal.com/apps',
    credentialsUrl: 'https://modal.com/settings/tokens',
    docs: 'https://modal.com/docs/guide/sdk-javascript-go',
    setup:
      'Create a token in your Modal workspace settings. Save both the token ID and token secret. The defaults below create or use the a0-slim app in the main environment.',
    lifetime:
      '60-second lifetime · outbound network denied · compute terminated; app and cached image may remain.',
    fields: [
      ['appName', 'App name', false, 'a0-slim'],
      ['environment', 'Environment', false, 'main'],
      ['tokenId', 'Token ID', true],
      ['tokenSecret', 'Token secret', true],
    ],
  },
  {
    id: 'e2b',
    name: 'E2B',
    offer: 'One-time credit',
    allowance: 'Hobby: $100 in one-time usage credits. No credit card required to start.',
    detail: 'Credits are introductory; additional usage is subject to your account plan.',
    url: 'https://e2b.dev/pricing',
    signup: 'https://console.e2b.dev/sign-up',
    signin: 'https://console.e2b.dev/sign-in',
    dashboard: 'https://console.e2b.dev',
    credentialsUrl: 'https://console.e2b.dev/?tab=keys',
    docs: 'https://docs.e2b.dev/quickstart',
    setup:
      'Create an E2B account, open API keys in the console, and create a key for A0 SLIM. Paste it below; no CLI installation is needed.',
    lifetime:
      '60-second kill timeout · outbound network and public traffic denied · deletion verified.',
    fields: [['apiKey', 'API key', true]],
  },
  {
    id: 'daytona',
    name: 'Daytona',
    offer: 'Introductory credit',
    allowance: '$200 in free compute to get started.',
    detail:
      'An introductory offer, with usage-based pricing afterward. Check account eligibility and balance.',
    url: 'https://www.daytona.io/pricing',
    signup: 'https://app.daytona.io',
    signin: 'https://app.daytona.io',
    dashboard: 'https://app.daytona.io/dashboard',
    credentialsUrl: 'https://app.daytona.io/dashboard/keys',
    docs: 'https://www.daytona.io/docs/en/api-keys/',
    setup:
      'Sign in or create an account in Daytona, then create an API key for your organization with write:sandboxes and delete:sandboxes permissions. Paste it below. This check uses the US region.',
    lifetime:
      'One-minute lifetime · outbound network denied · private preview · automatic deletion and explicit cleanup.',
    fields: [['apiKey', 'API key', true]],
  },
];
