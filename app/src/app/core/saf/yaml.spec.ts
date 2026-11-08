import { describe, expect, it } from 'vitest';
import { parseYaml } from './yaml';

describe('YAML subset reader for the workspace viewers (F5-R9)', () => {
  it('reads mappings, sequences, scalars and comments', () => {
    const doc = `# Copyright
slug: platform
name: "Platform ART"   # inline comment
teams:
  - api-team
  - portal-team
products: [customer-platform, gateway]
active: true
budget: 12.5
owner:
`;
    expect(parseYaml(doc)).toEqual({
      slug: 'platform',
      name: 'Platform ART',
      teams: ['api-team', 'portal-team'],
      products: ['customer-platform', 'gateway'],
      active: true,
      budget: 12.5,
      owner: null,
    });
  });

  it('reads sequences of mappings and nested mappings like a SAF workflow conf', () => {
    const doc = `---
slug: architectural-runway-extension
steps:
  - slug: author-nfrs
    actor: system-architect
    capabilities:
      deep-reasoning: 8
      coding: 3
    conditions: []
  - slug: author-adr
    actor: system-architect
    conditions:
      - kind: precondition
        step: author-nfrs
`;
    const value = parseYaml(doc) as {
      steps: Array<{ slug: string; capabilities?: Record<string, number>; conditions: unknown[] }>;
    };
    expect(value.steps).toHaveLength(2);
    expect(value.steps[0].capabilities).toEqual({ 'deep-reasoning': 8, coding: 3 });
    expect(value.steps[1].conditions).toEqual([{ kind: 'precondition', step: 'author-nfrs' }]);
  });

  it('reads literal and folded block scalars', () => {
    const doc = `description: |
  First line.
  Second line.
summary: >
  folded
  text
next: 1
`;
    expect(parseYaml(doc)).toEqual({ description: 'First line.\nSecond line.', summary: 'folded text', next: 1 });
  });

  it('throws on content it cannot read so the viewer falls back to source', () => {
    expect(() => parseYaml('key: value\n   broken: indent\n  other: x\n')).toThrow();
  });
});
