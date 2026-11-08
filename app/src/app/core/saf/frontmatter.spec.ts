import { describe, expect, it } from 'vitest';
import { parseArtifact, parseFrontmatter, serializeFrontmatter } from './frontmatter';

const ADR = `---
id: ADR-1
title: "Secure API"
status: proposed              # proposed | accepted | rejected | superseded
structurant: true
deciders:
  - central-supervisor
  - SE-Architect
cost:
  tokensIn: 12
  source: estimated
related_adrs: []
decided: null
---

# ADR-1 — Secure API

## Context
Forces at play.

## Decision
Use OAuth.

\`\`\`text
## not a heading
\`\`\`
`;

describe('SAF artifact frontmatter reader', () => {
  it('parses scalars, lists, one-level maps and strips comments', () => {
    const fm = parseFrontmatter(ADR.split('---')[1]);
    expect(fm['id']).toBe('ADR-1');
    expect(fm['title']).toBe('Secure API');
    expect(fm['status']).toBe('proposed');
    expect(fm['structurant']).toBe(true);
    expect(fm['deciders']).toEqual(['central-supervisor', 'SE-Architect']);
    expect(fm['cost']).toEqual({ tokensIn: 12, source: 'estimated' });
    expect(fm['related_adrs']).toEqual([]);
    expect(fm['decided']).toBeNull();
  });

  it('splits the body into sections by ## headings, ignoring fenced code', () => {
    const parsed = parseArtifact(ADR);
    expect(parsed.frontmatterPresent).toBe(true);
    expect(parsed.title).toBe('Secure API');
    expect(parsed.sections.map((s) => s.heading)).toEqual(['Context', 'Decision']);
    expect(parsed.sections[1].body).toContain('Use OAuth.');
  });

  it('round-trips through serializeFrontmatter', () => {
    const fm = parseArtifact(ADR).frontmatter;
    const again = parseFrontmatter(serializeFrontmatter(fm).split('---')[1]);
    expect(again).toEqual(fm);
  });

  it('handles a body without frontmatter', () => {
    const parsed = parseArtifact('# Title\n\nBody');
    expect(parsed.frontmatterPresent).toBe(false);
    expect(parsed.title).toBe('Title');
    expect(parsed.sections).toEqual([]);
  });
});
