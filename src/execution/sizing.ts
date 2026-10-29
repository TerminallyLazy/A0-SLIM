export type SizingProvider = 'vercel' | 'modal' | 'e2b' | 'daytona' | 'microsandbox' | 'docker';
export type SandboxSizing = { sessionTimeoutMinutes: number; vcpus: number; memoryMiB: number };
type Limits = {
  cpus: readonly number[];
  memory: readonly number[];
  maxMinutes: number;
  linkedMemory?: boolean;
  sessionTimeout: boolean;
  note: string;
};
/** Conservative CPU-only choices; account quotas and credit balances still belong to the provider. */
export const sizingLimits: Record<SizingProvider, Limits> = {
  vercel: {
    cpus: [1, 2, 4],
    memory: [2048, 4096, 8192],
    maxMinutes: 45,
    linkedMemory: true,
    sessionTimeout: true,
    note: 'Hobby sizes. Vercel assigns 2 GB of memory per vCPU; CPU and memory change together. Hobby stops new creation at its quota. Paid accounts still use their own billing rules.',
  },
  modal: {
    cpus: [0.25, 0.5, 1, 2],
    memory: [128, 256, 512, 1024, 2048],
    maxMinutes: 60,
    sessionTimeout: true,
    note: 'CPU-only sizes available on Starter. 2 vCPUs equal one Modal physical core. Uses shared free compute credit; check your remaining credit and workspace budget.',
  },
  e2b: {
    cpus: [2],
    memory: [4096],
    maxMinutes: 60,
    sessionTimeout: true,
    note: 'Hobby uses the default base template. Custom CPU and memory require Pro and are unavailable here. Check your remaining introductory credit.',
  },
  daytona: {
    cpus: [1, 2, 4],
    memory: [1024, 2048, 4096],
    maxMinutes: 60,
    sessionTimeout: true,
    note: 'Small CPU-only sizes within the entry-tier resource pool. Uses introductory credit; account quotas and remaining credit still apply.',
  },
  microsandbox: {
    cpus: [1, 2, 4],
    memory: [512, 1024, 2048, 4096],
    maxMinutes: 60,
    sessionTimeout: true,
    note: 'Uses your computer. Choose resources that leave enough capacity for other applications.',
  },
  docker: {
    cpus: [0.5, 1, 2, 4],
    memory: [128, 256, 512, 1024, 2048],
    maxMinutes: 60,
    sessionTimeout: false,
    note: 'Uses your computer. Docker containers end with each command; there is no separate provider session timeout.',
  },
};
export const defaultSizing: Record<SizingProvider, SandboxSizing> = {
  vercel: { sessionTimeoutMinutes: 15, vcpus: 1, memoryMiB: 2048 },
  modal: { sessionTimeoutMinutes: 15, vcpus: 0.5, memoryMiB: 128 },
  e2b: { sessionTimeoutMinutes: 15, vcpus: 2, memoryMiB: 4096 },
  daytona: { sessionTimeoutMinutes: 15, vcpus: 1, memoryMiB: 1024 },
  microsandbox: { sessionTimeoutMinutes: 15, vcpus: 1, memoryMiB: 512 },
  docker: { sessionTimeoutMinutes: 15, vcpus: 1, memoryMiB: 128 },
};
