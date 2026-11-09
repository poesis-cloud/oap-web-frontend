import { describe, expect, it } from 'vitest';
import { collapseUnchanged, diffLines } from './diff';

describe('line diff', () => {
  it('reports additions, removals and unchanged lines with their numbers', () => {
    const d = diffLines('a\nb\nc\n', 'a\nc\nd\n');
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.lines.map((l) => `${l.kind}:${l.text}`)).toEqual(['same:a', 'removed:b', 'same:c', 'added:d']);
    expect(d.lines[1]).toMatchObject({ oldNo: 2, newNo: null });
    expect(d.lines[3]).toMatchObject({ oldNo: null, newNo: 3 });
  });

  it('handles empty sides', () => {
    expect(diffLines('', 'x\ny').added).toBe(2);
    expect(diffLines('x\ny', '').removed).toBe(2);
    expect(diffLines('', '').lines).toEqual([]);
  });

  it('collapses long unchanged stretches around the changes', () => {
    const old = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const next = old.replace('l10', 'L10');
    const view = collapseUnchanged(diffLines(old, next).lines, 2);
    expect(view[0]).toBeNull();
    expect(view.filter((l) => l !== null).map((l) => l!.text)).toEqual(['l8', 'l9', 'l10', 'L10', 'l11', 'l12']);
    expect(view[view.length - 1]).toBeNull();
  });
});
