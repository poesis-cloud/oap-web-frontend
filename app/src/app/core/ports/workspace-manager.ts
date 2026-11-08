import type { Artifact, Commit } from '../domain/artifact';
import type { Run } from '../domain/run';
import type { ArtifactPath, CommitSha, SessionId, TenantId, WorkspaceId } from '../domain/types';
import type { Workspace } from '../domain/workspace';
import type { JournalEntry } from '../saf/contracts';

/**
 * Port of the **workspace manager** backend (`oap-workspace-manager`): the hosted SAF
 * workspaces (git; HEAD = state; one validated write = one commit) and the SAI workspace
 * records that point at them (F14, F17). Views never write through this port.
 *
 * Mocked in `infrastructure/workspace-manager/`.
 */

/** Read access to a hosted SAF workspace through git (F14-R10). */
export interface WorkspaceReadPort {
  head(workspaceId: WorkspaceId): CommitSha | null;
  /** Oldest first. */
  commits(workspaceId: WorkspaceId): readonly Commit[];
  paths(workspaceId: WorkspaceId): readonly ArtifactPath[];
  read(workspaceId: WorkspaceId, path: ArtifactPath): string | null;
  artifact(workspaceId: WorkspaceId, path: ArtifactPath): Artifact | null;
  /** Harness session logs of the workspace, in timestamp order. */
  journal(workspaceId: WorkspaceId): readonly JournalEntry[];
  journalForSession(workspaceId: WorkspaceId, sessionId: SessionId): readonly JournalEntry[];
  /** Runs rebuilt from the workspace state (`runs/<id>.run.json` at HEAD). */
  runs(workspaceId: WorkspaceId): readonly Run[];
}

/** The SAI workspace records (F17): name, tenant, organization package, hosted repository. */
export interface WorkspaceRepository {
  get(id: WorkspaceId): Workspace | undefined;
  listByTenant(tenantId: TenantId): readonly Workspace[];
  save(workspace: Workspace): void;
}
