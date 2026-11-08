import type { Artifact, WorkItem } from '../domain/artifact';
import { itemTypeForPath, type OrganizationPackage } from '../domain/organization';
import type { Run } from '../domain/run';
import type { ArtifactPath, WorkspaceId } from '../domain/types';
import { parseArtifact } from '../saf/frontmatter';
import type { WorkspaceReadPort } from '../ports';

/**
 * The board is a view over the workspace state and history read through git (F5-R1,
 * F14-R4). Work items are the artifacts whose kind the organization declares trackable,
 * with the status their frontmatter carries. Nothing here writes.
 */

export function dirname(path: ArtifactPath): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function deriveWorkItems(
  organization: OrganizationPackage,
  read: WorkspaceReadPort,
  workspaceId: WorkspaceId,
  runs: readonly Run[],
): WorkItem[] {
  const items: WorkItem[] = [];
  for (const path of read.paths(workspaceId)) {
    const type = itemTypeForPath(organization, path);
    if (!type) continue;
    const artifact = read.artifact(workspaceId, path);
    if (!artifact) continue;
    const parsed = parseArtifact(artifact.head.content);
    const status =
      typeof parsed.frontmatter['status'] === 'string' ? (parsed.frontmatter['status'] as string) : type.statuses[0];
    const folder = dirname(path);
    const runIds = runs
      .filter((run) =>
        run.steps.some(
          (step) => step.artifactPath !== null && (step.artifactPath === path || dirname(step.artifactPath) === folder),
        ),
      )
      .map((run) => run.id);
    items.push({
      path,
      type: type.slug,
      itemId: typeof parsed.frontmatter['id'] === 'string' ? (parsed.frontmatter['id'] as string) : null,
      title: parsed.title ?? path,
      status: type.statuses.includes(status) ? status : type.statuses[0],
      owner: typeof parsed.frontmatter['owner'] === 'string' ? (parsed.frontmatter['owner'] as string) : null,
      structurant: parsed.frontmatter['structurant'] === true,
      updatedAt: artifact.head.commit.timestamp,
      runIds,
    });
  }
  return items.sort((a, b) => a.path.localeCompare(b.path));
}

export function listArtifacts(read: WorkspaceReadPort, workspaceId: WorkspaceId): Artifact[] {
  return read
    .paths(workspaceId)
    .map((path) => read.artifact(workspaceId, path))
    .filter((a): a is Artifact => a !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}
