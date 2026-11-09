import type { ArtifactPath } from '../domain/types';
import type { TreeEntry } from './workspace-tree';

/**
 * The explorer shows the current directory the way GitHub does (Clément, 2026-11-09): the
 * tree on the left, the listing of one folder in the centre, folders first. Entries come from
 * the workspace tree laid on the organization's structure map, so a required slot still empty
 * appears as an expected, greyed row. Pure helpers over the tree.
 */

export interface Crumb {
  readonly name: string;
  readonly path: ArtifactPath;
}

export function findFolder(tree: readonly TreeEntry[], dir: string): TreeEntry | null {
  if (dir === '') return { kind: 'folder', name: '', path: '', description: '', expected: false, children: tree };
  for (const entry of tree) {
    if (entry.kind !== 'folder') continue;
    if (entry.path === dir) return entry;
    if (dir.startsWith(`${entry.path}/`)) {
      const hit = findFolder(entry.children, dir);
      if (hit) return hit;
    }
  }
  return null;
}

/** Folders first, then files; expected (missing) entries last within their group. */
export function listDirectory(tree: readonly TreeEntry[], dir: string): TreeEntry[] {
  const folder = findFolder(tree, dir);
  if (!folder || folder.kind !== 'folder') return [];
  const rank = (e: TreeEntry) => (e.kind === 'folder' ? 0 : 2) + (e.expected ? 1 : 0);
  return [...folder.children].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function crumbs(dir: string): Crumb[] {
  if (dir === '') return [];
  const parts = dir.split('/');
  return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }));
}

export function parentDir(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** Number of present files under a folder entry, for the listing's "n files" hint. */
export function fileCount(entry: TreeEntry): number {
  if (entry.kind === 'file') return entry.expected ? 0 : 1;
  return entry.children.reduce((sum, child) => sum + fileCount(child), 0);
}
