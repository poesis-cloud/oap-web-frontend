import { describe, expect, it } from 'vitest';
import { crumbs, fileCount, findFolder, listDirectory, parentDir } from './explorer';
import { buildWorkspaceTree, type WorkspaceStructure } from './workspace-tree';

const structure: WorkspaceStructure = {
  source: 'conf/workspace.conf.yaml',
  nodes: [
    {
      slug: 'portfolio',
      description: 'Workspace root folder.',
      children: [
        { slug: 'portfolio-manifest.yaml', description: 'Registry', artifact: 'portfolio-manifest', cardinality: '1' },
        {
          slug: 'art',
          description: 'ARTs',
          children: [
            {
              slug: '<art-slug>',
              description: 'One ART',
              children: [{ slug: '<feature-slug>.feature.md', description: 'Feature', artifact: 'feature' }],
            },
          ],
        },
      ],
    },
  ],
};
const paths = ['portfolio/art/platform/api.feature.md', 'portfolio/art/platform/notes.txt', 'organization/agents/a.agent.md', 'runs/r1.run.json'];

describe('explorer directory listing', () => {
  const tree = buildWorkspaceTree(structure, paths);

  it('lists the root with mapped folders, unmapped folders and expected files', () => {
    const names = listDirectory(tree, '').map((e) => `${e.kind}:${e.name}${e.expected ? '?' : ''}`);
    expect(names).toEqual(['folder:organization', 'folder:portfolio', 'folder:runs']);
    expect(listDirectory(tree, 'portfolio').find(e => e.name === 'portfolio-manifest.yaml')?.expected).toBe(true);
  });

  it('lists a nested folder, folders first then files', () => {
    expect(listDirectory(tree, 'portfolio/art/platform').map((e) => e.name)).toEqual(['api.feature.md', 'notes.txt']);
    expect(listDirectory(tree, 'organization').map((e) => e.name)).toEqual(['agents']);
    expect(listDirectory(tree, 'nowhere')).toEqual([]);
  });

  it('gives breadcrumbs, parents and file counts', () => {
    expect(crumbs('portfolio/art/platform')).toEqual([
      { name: 'portfolio', path: 'portfolio' },
      { name: 'art', path: 'portfolio/art' },
      { name: 'platform', path: 'portfolio/art/platform' },
    ]);
    expect(parentDir('portfolio/art/platform')).toBe('portfolio/art');
    expect(parentDir('portfolio')).toBe('');
    expect(fileCount(findFolder(tree, 'portfolio/art')!)).toBe(2);
  });
});
