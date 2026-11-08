import type { ModelProfile } from '../../core/domain/organization';
import type { ModelDeployment, ModelGatewayPort, ModelPrice, UsageRecord } from '../../core/ports';

/**
 * Mock of the model gateway (Azure AI Foundry behind the Poesis Models Gateway, poesis#42):
 * the deployments a tenant may use, the price list and the usage ledger. No model is called
 * in this build; the agent runtime mock records the tokens its scripted steps would have
 * consumed, and the price list rates them so that runs show a cost in euros (F3). Prices are
 * **fictitious**, derived from each profile's cost rank in the SAF catalog; the real gateway
 * publishes its own list (PIS F10).
 */
export class MockFoundry implements ModelGatewayPort {
  private readonly records: UsageRecord[] = [];
  private readonly prices = new Map<string, ModelPrice>();

  constructor(
    private readonly catalog: readonly ModelDeployment[] = DEFAULT_DEPLOYMENTS,
    profiles: readonly ModelProfile[] = [],
  ) {
    for (const profile of profiles) this.prices.set(profile.slug, priceForRank(profile.slug, profile.costRank));
  }

  deployments(): readonly ModelDeployment[] {
    return this.catalog;
  }
  priceOf(model: string): ModelPrice | null {
    return this.prices.get(model) ?? null;
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

/**
 * Fictitious EUR price bands by SAF cost rank: `conf/model-profiles.conf.yaml` ranks 1 (cheapest)
 * to 10 (most expensive), percentile-ranked on the blended token price of the catalog.
 */
export function priceForRank(model: string, costRank: number): ModelPrice {
  const [input, output] =
    costRank >= 9 ? [15, 75] : costRank >= 7 ? [5, 25] : costRank >= 5 ? [2.5, 10] : costRank >= 3 ? [1, 4] : [0.15, 0.6];
  return { model, currency: 'EUR', inputPerMTokens: input, outputPerMTokens: output };
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
