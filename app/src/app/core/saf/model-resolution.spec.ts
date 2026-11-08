import { describe, expect, it } from 'vitest';
import { loadSafePackage } from '../../infrastructure/agent-runtime/package-loader';
import type { ModelProfile } from '../domain/organization';
import { resolveModelProfile, scoreProfile } from './model-resolution';

const profile = (slug: string, costRank: number, caps: Partial<Record<string, number>>): ModelProfile => ({
  slug,
  costRank,
  description: slug,
  capabilities: caps as ModelProfile['capabilities'],
});

describe('resolve-step-model rule (harness spec, function 4, invariant 3)', () => {
  it('scores a weighted capability sum: the spec worked example (9 vs 7 at weight 9)', () => {
    const a = profile('a', 5, { 'deep-reasoning': 9 });
    const b = profile('b', 1, { 'deep-reasoning': 7 });
    expect(scoreProfile({ 'deep-reasoning': 9 }, a)).toBe(81);
    expect(scoreProfile({ 'deep-reasoning': 9 }, b)).toBe(63);
    expect(resolveModelProfile({ 'deep-reasoning': 9 }, [a, b])).toMatchObject({
      slug: 'a',
      score: 81,
      reason: 'highest weighted capability score',
    });
  });

  it('breaks a score tie toward the lower cost rank', () => {
    const pricey = profile('pricey-twin', 7, { coding: 4 });
    const cheap = profile('omega-twin', 3, { coding: 4 });
    const result = resolveModelProfile({ coding: 5 }, [pricey, cheap]);
    expect(result.slug).toBe('omega-twin');
    expect(result.reason).toBe('tie on score; lower cost rank');
  });

  it('breaks a score-and-cost tie toward the lexicographically lowest slug', () => {
    const omega = profile('omega-twin', 3, { coding: 4 });
    const alpha = profile('alpha-twin', 3, { coding: 4 });
    const result = resolveModelProfile({ coding: 5 }, [omega, alpha]);
    expect(result.slug).toBe('alpha-twin');
    expect(result.reason).toBe('tie on score and cost; lexicographically lowest slug');
  });

  it('refuses unroutable inputs: empty catalog or all-zero weights', () => {
    expect(() => resolveModelProfile({ coding: 1 }, [])).toThrow(/unroutable/);
    expect(() => resolveModelProfile({}, [profile('a', 1, { coding: 1 })])).toThrow(/unroutable/);
  });

  it('is deterministic and idempotent over the real SAF catalog for every runway step', () => {
    const pkg = loadSafePackage();
    const workflow = pkg.workflows.find((w) => w.slug === 'architectural-runway-extension');
    expect(workflow).toBeDefined();
    for (const step of workflow!.steps) {
      const first = resolveModelProfile(step.capabilities, pkg.modelProfiles);
      const second = resolveModelProfile(step.capabilities, pkg.modelProfiles);
      expect(second).toEqual(first);
      expect(pkg.modelProfiles.some((p) => p.slug === first.slug)).toBe(true);
    }
  });
});
