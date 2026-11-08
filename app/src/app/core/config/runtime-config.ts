/**
 * Deploy-time configuration (same mechanism as OIP: `public/runtime-config.js` sets
 * `window.__SAI_CONFIG__`). `backends: 'mock'` wires the in-browser mocks; `'live'` will wire
 * the HTTP and git adapters of the five backends once their contracts exist.
 */
export interface RuntimeConfig {
  readonly envName: string;
  readonly backends: 'mock' | 'live';
  /** `hash` for static hosts without an SPA fallback (a folder of a GitHub Pages site); `path` otherwise. */
  readonly routing: 'path' | 'hash';
  readonly workspaceManagerUrl: string;
  readonly conversationManagerUrl: string;
  readonly agentRuntimeUrl: string;
  readonly iamUrl: string;
  readonly iamRealm: string;
  readonly modelGatewayUrl: string;
}

declare global {
  interface Window {
    __SAI_CONFIG__?: Partial<RuntimeConfig>;
  }
}

const DEFAULTS: RuntimeConfig = {
  envName: 'dev',
  backends: 'mock',
  routing: 'path',
  workspaceManagerUrl: '',
  conversationManagerUrl: '',
  agentRuntimeUrl: '',
  iamUrl: '',
  iamRealm: '',
  modelGatewayUrl: '',
};

export function getRuntimeConfig(): RuntimeConfig {
  const fromWindow = typeof window !== 'undefined' ? (window.__SAI_CONFIG__ ?? {}) : {};
  return { ...DEFAULTS, ...fromWindow };
}
