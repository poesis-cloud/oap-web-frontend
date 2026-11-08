import type { ConversationId, IsoDateTime, RunId, SessionId, TenantId, UserId, WorkspaceId } from '../domain/types';

/**
 * Port of the **model gateway** (Azure AI Foundry behind the Poesis Models Gateway,
 * poesis#42): the model deployments a tenant may use and the usage attributed to every call
 * (F2, F3, R4). The browser never calls a model; this port only exposes what the UI shows.
 *
 * Mocked in `infrastructure/model-gateway/`.
 */

export interface ModelDeployment {
  readonly name: string;
  /** Canonical model slug of the SAF catalog this deployment serves. */
  readonly profile: string;
  readonly provider: string;
  readonly region: string;
  readonly dataZone: 'EU' | 'US' | 'APAC' | 'single-region';
}

export interface UsageRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly workspaceId: WorkspaceId;
  readonly conversationId: ConversationId | null;
  readonly runId: RunId | null;
  readonly stepSlug: string | null;
  readonly sessionId: SessionId;
  readonly userId: UserId | null;
  readonly model: string;
  readonly source: 'poesis-models-gateway' | 'tenant-provided' | 'mock-gateway';
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly at: IsoDateTime;
}

export interface UsageLedger {
  record(record: UsageRecord): void;
  forRun(runId: RunId): readonly UsageRecord[];
  forTenant(tenantId: TenantId): readonly UsageRecord[];
}

export interface ModelGatewayPort extends UsageLedger {
  deployments(tenantId: TenantId): readonly ModelDeployment[];
}
