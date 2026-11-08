/**
 * Ports of the application layer, one file per backend the frontend talks to. The
 * presentation layer depends on the application; the infrastructure implements these ports.
 * Today every port is served by an in-browser mock (`infrastructure/`); tomorrow by the
 * HTTP and git adapters of the real backends, without touching `core/`.
 */
export * from './shared';
export * from './workspace-manager';
export * from './conversation-manager';
export * from './agent-runtime';
export * from './iam';
export * from './model-gateway';
