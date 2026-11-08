import type { ModelDeployment, ModelGatewayPort, UsageRecord } from '../../core/ports';

/**
 * Mock of the model gateway (Azure AI Foundry behind the Poesis Models Gateway, poesis#42):
 * the deployments a tenant may use and the usage ledger. No model is called in this build;
 * the agent runtime mock records the tokens its scripted steps would have consumed.
 */
export class MockFoundry implements ModelGatewayPort {
  private readonly records: UsageRecord[] = [];
  constructor(private readonly catalog: readonly ModelDeployment[] = DEFAULT_DEPLOYMENTS) {}

  deployments(): readonly ModelDeployment[] {
    return this.catalog;
  }
  record(record: UsageRecord): void {
    this.records.push(record);
  }
  forRun(runId: string): readonly UsageRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }
  forTenant(tenantId: string): readonly UsageRecord[] {
    return this.records.filter((r) => r.tenantId === tenantId);
  }
}

/** Fictitious EU data-zone deployments named after SAF catalog profiles. */
export const DEFAULT_DEPLOYMENTS: readonly ModelDeployment[] = [
  {
    name: 'eu-reasoning-large',
    profile: 'claude-opus-4.8',
    provider: 'Azure AI Foundry (mock)',
    region: 'swedencentral',
    dataZone: 'EU',
  },
  {
    name: 'eu-coding-standard',
    profile: 'gpt-5.5',
    provider: 'Azure AI Foundry (mock)',
    region: 'francecentral',
    dataZone: 'EU',
  },
  {
    name: 'eu-fast-small',
    profile: 'gpt-5.4-mini',
    provider: 'Azure AI Foundry (mock)',
    region: 'swedencentral',
    dataZone: 'EU',
  },
];
