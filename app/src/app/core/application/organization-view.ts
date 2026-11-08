import type { Commit } from '../domain/artifact';
import type { ArtifactPath, CommitSha } from '../domain/types';
import { plainTree, type TreeEntry } from './workspace-tree';

/**
 * The organization of a workspace is a folder of the workspace git (`organization/`),
 * imported from the SAF package as one tagged commit and changed only by governed runs
 * (oap#1, F16-R1..R3). These pure helpers give the Organization surface its views: the
 * folder as a tree, each file's category, the history of the folder and the gap to nominal.
 */

export const ORGANIZATION_ROOT = 'organization';
const PREFIX = `${ORGANIZATION_ROOT}/`;

export type OrganizationCategory =
  | 'agent'
  | 'workflow'
  | 'skill'
  | 'instruction'
  | 'schema'
  | 'template'
  | 'configuration'
  | 'manifest'
  | 'other';

export const CATEGORY_LABELS: Record<OrganizationCategory, string> = {
  agent: 'Agent',
  workflow: 'Workflow',
  skill: 'Skill',
  instruction: 'Instructions',
  schema: 'Artifact schema',
  template: 'Template',
  configuration: 'Configuration',
  manifest: 'Package manifest',
  other: 'File',
};

/** Order of the top-level folders in the Organization explorer. */
export const FOLDER_ORDER = ['agents', 'workflows', 'skills', 'instructions', 'artifacts', 'conf'];

export function isOrganizationPath(path: ArtifactPath): boolean {
  return path.startsWith(PREFIX);
}

export function organizationPaths(paths: readonly ArtifactPath[]): ArtifactPath[] {
  return paths.filter(isOrganizationPath);
}

/** Paths of the workspace content, the organization folder left out (it has its own surface). */
export function contentPaths(paths: readonly ArtifactPath[]): ArtifactPath[] {
  return paths.filter((p) => !isOrganizationPath(p));
}

export function organizationCategory(path: ArtifactPath): OrganizationCategory {
  const rest = path.startsWith(PREFIX) ? path.slice(PREFIX.length) : path;
  const [folder] = rest.split('/');
  if (rest === 'package.json' || rest === 'README.md') return 'manifest';
  if (folder === 'agents') return 'agent';
  if (folder === 'workflows') return 'workflow';
  if (folder === 'skills') return 'skill';
  if (folder === 'instructions') return 'instruction';
  if (folder === 'artifacts') return rest.endsWith('.schema.json') ? 'schema' : 'template';
  if (folder === 'conf') return 'configuration';
  return 'other';
}

/** The organization folder as a tree, main folders first in a fixed order, then the files. */
export function organizationTree(paths: readonly ArtifactPath[]): TreeEntry[] {
  const entries = plainTree(organizationPaths(paths), PREFIX);
  const rank = (e: TreeEntry) => {
    if (e.kind === 'file') return FOLDER_ORDER.length + 1;
    const index = FOLDER_ORDER.indexOf(e.name);
    return index === -1 ? FOLDER_ORDER.length : index;
  };
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export interface OrganizationChange {
  readonly commit: Commit;
  readonly paths: readonly ArtifactPath[];
  readonly nominal: boolean;
}

/** Commits that touched the organization folder, newest first; the nominal import is flagged. */
export function organizationHistory(commits: readonly Commit[], nominalImport: CommitSha | null): OrganizationChange[] {
  return commits
    .map((commit) => ({
      commit,
      paths: Object.keys(commit.changes).filter(isOrganizationPath),
      nominal: commit.sha === nominalImport || (commit.tag?.startsWith('nominal-import/') ?? false),
    }))
    .filter((c) => c.paths.length > 0)
    .reverse();
}

/** Organization paths changed after the nominal import: the gap between the package and the workspace (F16). */
export function gapToNominal(commits: readonly Commit[], nominalImport: CommitSha | null): ArtifactPath[] {
  const changed = new Set<ArtifactPath>();
  let after = nominalImport === null;
  for (const commit of commits) {
    if (after) for (const path of Object.keys(commit.changes)) if (isOrganizationPath(path)) changed.add(path);
    if (commit.sha === nominalImport) after = true;
  }
  return [...changed].sort();
}
