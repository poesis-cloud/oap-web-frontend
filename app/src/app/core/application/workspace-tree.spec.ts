import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceTree,
  countFiles,
  rootNodes,
  segmentMatcher,
  type TreeEntry,
  type WorkspaceStructure,
} from './workspace-tree';

const structure: WorkspaceStructure = {
  source: 'test',
  nodes: [
    {
      slug: 'portfolio',
      description: 'Workspace root folder.',
      children: [
        { slug: 'portfolio-manifest.yaml', description: 'Manifest', artifact: 'portfolio-manifest', cardinality: '1' },
        {
          slug: 'art',
          description: 'ARTs',
          children: [
            {
              slug: '<art-slug>',
              description: 'ART folder',
              children: [
                { slug: 'art-manifest.yaml', description: 'ART manifest', artifact: 'art-manifest', cardinality: '1' },
                {
                  slug: 'program-backlog',
                  description: 'Backlog',
                  children: [
                    {
                      slug: '<feature-slug>',
                      description: 'Feature folder',
                      children: [
                        {
                          slug: '<feature-slug>.feature.md',
                          description: 'Feature',
                          artifact: 'feature',
                          cardinality: '1',
                        },
                        { slug: '<adr-slug>.adr.md', description: 'ADR', artifact: 'adr', cardinality: '0..*' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function find(entries: readonly TreeEntry[], path: string): TreeEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    if (entry.kind === 'folder') {
      const hit = find(entry.children, path);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('workspace tree from the organization structure map (F5-R7, F5-R8)', () => {
  it('matches placeholder slugs against one path segment', () => {
    expect(segmentMatcher('<feature-slug>.feature.md').test('subscriptions-api.feature.md')).toBe(true);
    expect(segmentMatcher('<feature-slug>.feature.md').test('subscriptions-api.adr.md')).toBe(false);
    expect(segmentMatcher('pi-<pi-slug>').test('pi-2026-q4')).toBe(true);
    expect(segmentMatcher('art-manifest.yaml').test('art-manifest.yaml')).toBe(true);
  });

  it('preserves the root folder declared in SAF artifact paths', () => {
    expect(rootNodes(structure).map((n) => n.slug)).toEqual(['portfolio']);
  });

  it('lays present paths on the map, marks required slots as expected and keeps unknown paths', () => {
    const tree = buildWorkspaceTree(structure, [
      'portfolio/art/platform/program-backlog/subscriptions/subscriptions.feature.md',
      'portfolio/art/platform/program-backlog/subscriptions/api-security.adr.md',
      'portfolio/art/platform/program-backlog/subscriptions/notes.txt',
      'runs/run-0001.run.json',
    ]);
    const feature = find(tree, 'portfolio/art/platform/program-backlog/subscriptions/subscriptions.feature.md');
    expect(feature?.kind).toBe('file');
    expect(feature && feature.kind === 'file' ? feature.artifact : null).toBe('feature');
    const adr = find(tree, 'portfolio/art/platform/program-backlog/subscriptions/api-security.adr.md');
    expect(adr && adr.kind === 'file' ? adr.artifact : null).toBe('adr');
    const manifest = find(tree, 'portfolio/portfolio-manifest.yaml');
    expect(manifest && manifest.kind === 'file' ? manifest.expected : null).toBe(true);
    const artManifest = find(tree, 'portfolio/art/platform/art-manifest.yaml');
    expect(artManifest && artManifest.kind === 'file' ? artManifest.expected : null).toBe(true);
    expect(find(tree, 'portfolio/art/platform/program-backlog/subscriptions/notes.txt')?.kind).toBe('file');
    const runs = tree.find((e) => e.name === 'runs');
    expect(runs?.kind).toBe('folder');
    expect(find(tree, 'runs/run-0001.run.json')).toBeDefined();
    expect(countFiles(tree)).toEqual({ present: 4, expected: 2 });
  });
});
