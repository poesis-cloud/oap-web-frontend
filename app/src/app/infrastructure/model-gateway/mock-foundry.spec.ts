import { describe, expect, it } from 'vitest';
import { usageCost } from '../../core/ports';
import { MockFoundry, priceForRank } from './mock-foundry';

describe('mocked model gateway price list', () => {
  it('rates by SAF cost rank: 1 is the cheapest, 10 the most expensive', () => {
    expect(priceForRank('cheap', 1).inputPerMTokens).toBeLessThan(priceForRank('mid', 5).inputPerMTokens);
    expect(priceForRank('mid', 5).outputPerMTokens).toBeLessThan(priceForRank('top', 10).outputPerMTokens);
    expect(priceForRank('top', 10)).toEqual({ model: 'top', currency: 'EUR', inputPerMTokens: 15, outputPerMTokens: 75 });
  });

  it('prices the catalog profiles it was given and nothing else', () => {
    const gateway = new MockFoundry(undefined, [
      { slug: 'gpt-5-mini', costRank: 1, description: '', capabilities: {} },
      { slug: 'gpt-5.5', costRank: 9, description: '', capabilities: {} },
    ]);
    expect(gateway.priceOf('gpt-5-mini')?.inputPerMTokens).toBe(0.15);
    expect(gateway.priceOf('gpt-5.5')?.outputPerMTokens).toBe(75);
    expect(gateway.priceOf('unknown')).toBeNull();
    const record = {
      id: 'u',
      tenantId: 't',
      workspaceId: 'w',
      conversationId: null,
      runId: 'r',
      stepSlug: 's',
      sessionId: 'sess',
      userId: null,
      model: 'gpt-5.5',
      source: 'mock-gateway' as const,
      tokensIn: 1_000_000,
      tokensOut: 0,
      at: '2026-11-08T12:00:00.000Z',
    };
    expect(usageCost(record, gateway.priceOf('gpt-5.5'))).toBe(15);
    expect(usageCost(record, gateway.priceOf('unknown'))).toBeNull();
  });
});
