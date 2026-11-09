import type { WorkspaceReadPort } from '../../core/ports';
import type { Artifact, ArtifactVersion, Commit } from '../../core/domain/artifact';
import type { Run } from '../../core/domain/run';
import {
  DomainError,
  type ArtifactPath,
  type CommitSha,
  type SessionId,
  type WorkspaceId,
} from '../../core/domain/types';
import { isValidJournalEntry, type JournalEntry } from '../../core/saf/contracts';

/**
 * In-memory stand-in for a hosted SAF workspace: a linear git-like history where committed
 * state is the workspace state, plus the harness's session logs kept outside the commit gate
 * (logs are working-tree only in SAF). It implements the read port the views use and the
 * write surface only the demo runtime may call.
 *
 * Boundaries honoured: one validated write = one commit attributed to the acting session
 * (F14-R2), append-only history (F14-R3), one repository per workspace with no cross-workspace
 * index (F14-R6), journal entries validated against the harness log-entry contract.
 */

export interface WriteCommand {
  readonly workspaceId: WorkspaceId;
  readonly message: string;
  readonly sessionId: SessionId | null;
  readonly runId: string | null;
  readonly stepSlug: string | null;
  readonly author: Commit['author'];
  readonly changes: Readonly<Record<ArtifactPath, string | null>>;
  readonly tag?: string | null;
  readonly timestamp: string;
}

interface Repository {
  commits: Commit[];
  head: Map<ArtifactPath, string>;
  logs: Map<SessionId, JournalEntry[]>;
}

export class InMemoryWorkspace implements WorkspaceReadPort {
  private readonly repositories = new Map<WorkspaceId, Repository>();

  init(workspaceId: WorkspaceId): void {
    if (!this.repositories.has(workspaceId)) {
      this.repositories.set(workspaceId, { commits: [], head: new Map(), logs: new Map() });
    }
  }

  has(workspaceId: WorkspaceId): boolean {
    return this.repositories.has(workspaceId);
  }

  /** The only write surface: a validated write becomes exactly one commit. */
  commit(command: WriteCommand): Commit {
    const repo = this.repo(command.workspaceId);
    const entries = Object.entries(command.changes);
    if (entries.length === 0) throw new DomainError('empty-write', 'A commit needs at least one change');
    const parent = repo.commits.length ? repo.commits[repo.commits.length - 1].sha : null;
    const sha = hash(`${parent ?? ''}\n${command.message}\n${command.timestamp}\n${JSON.stringify(command.changes)}`);
    for (const [path, content] of entries) {
      if (content === null) repo.head.delete(path);
      else repo.head.set(path, content);
    }
    const commit: Commit = {
      sha,
      parent,
      message: command.message,
      sessionId: command.sessionId,
      runId: command.runId,
      stepSlug: command.stepSlug,
      author: command.author,
      timestamp: command.timestamp,
      changes: command.changes,
      tag: command.tag ?? null,
    };
    repo.commits.push(commit);
    return commit;
  }

  appendLog(workspaceId: WorkspaceId, entry: JournalEntry): void {
    if (!isValidJournalEntry(entry)) {
      throw new DomainError(
        'invalid-log-entry',
        `Log entry violates the harness log-entry contract: ${JSON.stringify(entry).slice(0, 200)}`,
      );
    }
    const repo = this.repo(workspaceId);
    const sessionId = entry.report.context.sessionId;
    const log = repo.logs.get(sessionId) ?? [];
    const last = log[log.length - 1];
    if (last && last.report.context.function === 'end-session') {
      throw new DomainError('session-ended', `Session ${sessionId} has ended; no entry may follow (C8)`);
    }
    log.push(entry);
    repo.logs.set(sessionId, log);
  }

  // ------------------------------------------------------------------ reads

  head(workspaceId: WorkspaceId): CommitSha | null {
    const repo = this.repositories.get(workspaceId);
    return repo && repo.commits.length ? repo.commits[repo.commits.length - 1].sha : null;
  }

  commits(workspaceId: WorkspaceId): readonly Commit[] {
    // A fresh snapshot each time: the history grows in place, and a view that caches by reference
    // (an Angular computed signal) would otherwise never see a new commit.
    return [...(this.repositories.get(workspaceId)?.commits ?? [])];
  }

  paths(workspaceId: WorkspaceId): readonly ArtifactPath[] {
    const repo = this.repositories.get(workspaceId);
    return repo ? [...repo.head.keys()].sort() : [];
  }

  read(workspaceId: WorkspaceId, path: ArtifactPath): string | null {
    return this.repositories.get(workspaceId)?.head.get(path) ?? null;
  }

  artifact(workspaceId: WorkspaceId, path: ArtifactPath): Artifact | null {
    const repo = this.repositories.get(workspaceId);
    if (!repo || !repo.head.has(path)) return null;
    const versions: ArtifactVersion[] = [];
    for (const commit of repo.commits) {
      if (Object.prototype.hasOwnProperty.call(commit.changes, path)) {
        const content = commit.changes[path];
        if (content !== null) versions.push({ path, commit, content });
      }
    }
    versions.reverse();
    const head = versions[0];
    if (!head) return null;
    return { path, kind: null, head, versions };
  }

  journal(workspaceId: WorkspaceId): readonly JournalEntry[] {
    const repo = this.repositories.get(workspaceId);
    if (!repo) return [];
    return [...repo.logs.values()].flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  journalForSession(workspaceId: WorkspaceId, sessionId: SessionId): readonly JournalEntry[] {
    return this.repositories.get(workspaceId)?.logs.get(sessionId) ?? [];
  }

  /** Runs are rebuilt from `runs/<id>.run.json` at HEAD: the workspace is the system of record. */
  runs(workspaceId: WorkspaceId): readonly Run[] {
    const repo = this.repositories.get(workspaceId);
    if (!repo) return [];
    const runs: Run[] = [];
    for (const [path, content] of repo.head) {
      if (path.startsWith('runs/') && path.endsWith('.run.json')) {
        runs.push(JSON.parse(content) as Run);
      }
    }
    return runs;
  }

  private repo(workspaceId: WorkspaceId): Repository {
    const repo = this.repositories.get(workspaceId);
    if (!repo) throw new DomainError('workspace-missing', `No hosted workspace for ${workspaceId}`);
    return repo;
  }
}

/** FNV-1a 32-bit, twice, rendered as a 16-hex "sha": deterministic and dependency-free. */
export function hash(input: string): string {
  const a = fnv1a(input);
  const b = fnv1a(`${a}:${input}`);
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
