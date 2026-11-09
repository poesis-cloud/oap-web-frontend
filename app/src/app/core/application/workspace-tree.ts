import type { ArtifactPath } from '../domain/types';

/**
 * The workspace explorer follows the organization's **workspace structure map**
 * (`conf/workspace.conf.yaml` of the SAF organization): a tree of `folder` and `artifact`
 * nodes whose slugs may carry `<variable>` placeholders (`<art-slug>`, `<feature-slug>.feature.md`).
 *
 * `buildWorkspaceTree` lays the paths present at HEAD onto that map: present files and
 * folders are shown where the map places them; required slots the map declares but the
 * workspace lacks are shown as *expected* (the gap to nominal, F16-R1 flavour); paths the map
 * does not know (organization folder, run records) appear as plain folders at the root. Nothing
 * here reads content: it is a pure view over paths.
 */

export interface StructureNode {
  readonly slug: string;
  readonly description: string;
  readonly artifact?: string;
  readonly template?: string;
  readonly cardinality?: string;
  readonly children?: readonly StructureNode[];
}

export interface WorkspaceStructure {
  readonly source: string;
  readonly nodes: readonly StructureNode[];
}

export type TreeEntry =
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly path: ArtifactPath;
      readonly description: string;
      readonly expected: boolean;
      readonly children: readonly TreeEntry[];
    }
  | {
      readonly kind: 'file';
      readonly name: string;
      readonly path: ArtifactPath;
      readonly description: string;
      readonly artifact: string | null;
      /** Declared by the map with cardinality `1` but absent from the workspace. */
      readonly expected: boolean;
    };

const PLACEHOLDER = /<[a-z0-9-]+>/g;

/** Turns a slug with placeholders into a matcher for one path segment. */
export function segmentMatcher(slug: string): RegExp {
  const pattern = slug
    .split(PLACEHOLDER)
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[a-z0-9][a-z0-9-]*');
  return new RegExp(`^${pattern}$`, 'i');
}

export function hasPlaceholder(slug: string): boolean {
  return PLACEHOLDER.test(slug) && ((PLACEHOLDER.lastIndex = 0), true);
}

/**
 * The structure map's single root node ("Workspace root folder") is the workspace itself:
 * the SAF artifact schemas declare their path patterns relative to it (`art/<art>/program-backlog/...`), so the
 * root slug is not a path segment. This is an open point for SAF (see docs/10-open-questions).
 */
export function rootNodes(structure: WorkspaceStructure): readonly StructureNode[] {
  if (
    structure.nodes.length === 1 &&
    /workspace root/i.test(structure.nodes[0].description) &&
    structure.nodes[0].children
  ) {
    return structure.nodes[0].children;
  }
  return structure.nodes;
}

export function buildWorkspaceTree(
  structure: WorkspaceStructure,
  paths: readonly ArtifactPath[],
): readonly TreeEntry[] {
  const sorted = [...paths].sort();
  const consumed = new Set<ArtifactPath>();
  const entries = layNodes(rootNodes(structure), '', sorted, consumed);
  // Paths the map does not declare (the organization folder, run records, extra files) sit at
  // the root as plain folders, like any file explorer would show them.
  const unmapped = sorted.filter((p) => !consumed.has(p));
  if (unmapped.length > 0) entries.push(...plainTree(unmapped, ''));
  return entries;
}

function layNodes(
  nodes: readonly StructureNode[],
  prefix: string,
  paths: readonly ArtifactPath[],
  consumed: Set<ArtifactPath>,
): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const firstSegments = new Map<string, ArtifactPath[]>();
  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue;
    const rest = prefix ? path.slice(prefix.length) : path;
    const segment = rest.split('/')[0];
    if (!segment) continue;
    firstSegments.set(segment, [...(firstSegments.get(segment) ?? []), path]);
  }
  for (const node of nodes) {
    const matcher = segmentMatcher(node.slug);
    const matches = [...firstSegments.keys()].filter((segment) => matcher.test(segment));
    const isFile = node.artifact !== undefined;
    if (matches.length === 0) {
      if (!hasPlaceholder(node.slug) && (node.cardinality === '1' || node.children)) {
        const path = `${prefix}${node.slug}`;
        entries.push(
          isFile
            ? {
                kind: 'file',
                name: node.slug,
                path,
                description: node.description,
                artifact: node.artifact ?? null,
                expected: true,
              }
            : { kind: 'folder', name: node.slug, path, description: node.description, expected: true, children: [] },
        );
      }
      continue;
    }
    for (const segment of matches.sort()) {
      const path = `${prefix}${segment}`;
      const under = firstSegments.get(segment) ?? [];
      if (isFile) {
        if (under.includes(path)) {
          consumed.add(path);
          entries.push({
            kind: 'file',
            name: segment,
            path,
            description: node.description,
            artifact: node.artifact ?? null,
            expected: false,
          });
        }
        continue;
      }
      const children = layNodes(node.children ?? [], `${path}/`, under, consumed);
      // Files inside a mapped folder that no child node declares stay visible in place.
      const leftovers = under.filter((p) => !consumed.has(p) && p.startsWith(`${path}/`));
      if (leftovers.length > 0) {
        children.push(...plainTree(leftovers, `${path}/`));
        for (const p of leftovers) consumed.add(p);
      }
      entries.push({ kind: 'folder', name: segment, path, description: node.description, expected: false, children });
    }
  }
  return entries;
}

/** A plain folder tree for paths outside the map. */
export function plainTree(paths: readonly ArtifactPath[], prefix: string): TreeEntry[] {
  const folders = new Map<string, ArtifactPath[]>();
  const files: TreeEntry[] = [];
  for (const path of paths) {
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) files.push({ kind: 'file', name: rest, path, description: '', artifact: null, expected: false });
    else {
      const segment = rest.slice(0, slash);
      folders.set(segment, [...(folders.get(segment) ?? []), path]);
    }
  }
  const folderEntries: TreeEntry[] = [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, under]) => ({
      kind: 'folder',
      name: segment,
      path: `${prefix}${segment}`,
      description: '',
      expected: false,
      children: plainTree(under, `${prefix}${segment}/`),
    }));
  return [...folderEntries, ...files.sort((a, b) => a.name.localeCompare(b.name))];
}

export function countFiles(entries: readonly TreeEntry[]): { present: number; expected: number } {
  let present = 0;
  let expected = 0;
  for (const entry of entries) {
    if (entry.kind === 'file') {
      if (entry.expected) expected += 1;
      else present += 1;
    } else {
      const sub = countFiles(entry.children);
      present += sub.present;
      expected += sub.expected;
    }
  }
  return { present, expected };
}
