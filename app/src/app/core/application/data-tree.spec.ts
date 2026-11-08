import { describe, expect, it } from 'vitest';
import { countLeaves, toDataNodes } from './data-tree';

describe('data tree for JSON and YAML viewers (F5-R9)', () => {
  it('turns nested values into labelled nodes with paths and sizes', () => {
    const nodes = toDataNodes(
      { id: 'F-12', tags: ['a', 'b'], meta: { structurant: true, risk: null } },
      { id: 'Identifier' },
    );
    expect(nodes.map((n) => [n.key, n.label, n.type, n.value, n.size])).toEqual([
      ['id', 'Identifier', 'string', 'F-12', 0],
      ['tags', 'tags', 'array', null, 2],
      ['meta', 'meta', 'object', null, 2],
    ]);
    expect(nodes[1].children.map((c) => c.path)).toEqual(['tags[0]', 'tags[1]']);
    expect(nodes[2].children.map((c) => [c.path, c.type])).toEqual([
      ['meta.structurant', 'boolean'],
      ['meta.risk', 'null'],
    ]);
    expect(countLeaves(nodes)).toBe(5);
  });
});
