import type { ActorRef, ArtifactPath, CommitSha, IsoDateTime, RunId, SessionId } from './types';

/**
 * Workspace content as SAI reads it through git (F5, F14): commits, artifact versions and
 * the work items derived from them. Views are rebuilt from state and history alone (F14-R4).
 */

export interface Commit {
  readonly sha: CommitSha;
  readonly parent: CommitSha | null;
  readonly message: string;
  /** The acting session the harness attributed the validated write to (F14-R2). */
  readonly sessionId: SessionId | null;
  readonly runId: RunId | null;
  readonly stepSlug: string | null;
  readonly author: ActorRef | { readonly kind: 'harness' } | { readonly kind: 'installer' };
  readonly timestamp: IsoDateTime;
  /** Paths written by this commit; `null` content deletes the path. */
  readonly changes: Readonly<Record<ArtifactPath, string | null>>;
  readonly tag: string | null;
}

export interface ArtifactVersion {
  readonly path: ArtifactPath;
  readonly commit: Commit;
  readonly content: string;
}

export interface Artifact {
  readonly path: ArtifactPath;
  readonly kind: string | null;
  readonly head: ArtifactVersion;
  /** Newest first. */
  readonly versions: readonly ArtifactVersion[];
}

export interface WorkItem {
  readonly path: ArtifactPath;
  readonly type: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly status: string;
  readonly owner: string | null;
  readonly structurant: boolean;
  readonly updatedAt: IsoDateTime;
  readonly runIds: readonly RunId[];
}

export function artifactFileName(path: ArtifactPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function artifactFormat(path: ArtifactPath): 'markdown' | 'json' | 'yaml' | 'jsonl' | 'text' {
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.jsonl')) return 'jsonl';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  return 'text';
}
