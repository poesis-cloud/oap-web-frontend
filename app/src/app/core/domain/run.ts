import type { GateStatus, RunStatus, StepRunStatus } from './lifecycles';
import type {
  ActorRef,
  ArtifactPath,
  CommitSha,
  ConversationId,
  GateId,
  IsoDateTime,
  ProposalId,
  RunId,
  SessionId,
  WorkspaceId,
} from './types';

/**
 * Runs, steps, gates and model routes are SAF-owned facts that SAI reads from the
 * workspace (F4-R6, F14). SAI stores none of them: this module only types the read model.
 */

/** The model profile the harness resolved for a step (`resolve-step-model`, F4-R8). */
export interface ModelRoute {
  readonly profile: string;
  readonly score: number;
  readonly costRank: number;
  readonly reason: string;
  /** Host binding of the canonical profile; null when no model was called (demo). */
  readonly hostModel: string | null;
}

export interface HarnessVerdict {
  readonly fn: string;
  readonly status: string;
  readonly at: IsoDateTime;
  readonly detail?: string;
}

export interface StepRun {
  readonly stepSlug: string;
  readonly actor: string;
  readonly sessionId: SessionId;
  readonly attempt: number;
  readonly status: StepRunStatus;
  readonly model: ModelRoute | null;
  readonly tokens: { readonly input: number; readonly output: number };
  readonly artifactPath: ArtifactPath | null;
  readonly commitSha: CommitSha | null;
  readonly verdicts: readonly HarnessVerdict[];
  readonly challengeRounds: number;
  readonly startedAt: IsoDateTime | null;
  readonly endedAt: IsoDateTime | null;
}

export interface Gate {
  readonly id: GateId;
  readonly runId: RunId;
  readonly slug: string;
  readonly label: string;
  readonly holderRole: string;
  readonly artifactPath: ArtifactPath;
  readonly status: GateStatus;
  readonly raisedAt: IsoDateTime;
  readonly decidedBy: ActorRef | null;
  readonly decidedAt: IsoDateTime | null;
  readonly comment: string | null;
  /** Reviewer time in seconds, recorded for cost per accepted artifact (R14). */
  readonly reviewerSeconds: number | null;
}

export interface Run {
  readonly id: RunId;
  readonly workspaceId: WorkspaceId;
  readonly conversationId: ConversationId;
  readonly proposalId: ProposalId;
  readonly workflowSlug: string;
  /** Minted by the harness: `<workflowSlug>-<CROCKFORD32>`. */
  readonly workflowInstanceId: string;
  readonly orchestratorSessionId: SessionId;
  readonly launchedBy: ActorRef;
  /** The organization is read at the commit where the run starts (F4-R11). */
  readonly organizationCommit: CommitSha;
  readonly status: RunStatus;
  readonly steps: readonly StepRun[];
  readonly gates: readonly Gate[];
  readonly budget: { readonly limitTokens: number };
  readonly startedAt: IsoDateTime;
  readonly endedAt: IsoDateTime | null;
  readonly failure: { readonly code: 'budget' | 'harness' | 'cancelled'; readonly message: string } | null;
  /** Artifacts kept when a run is cancelled, marked partial (F4-R7). */
  readonly partialArtifacts: readonly ArtifactPath[];
}

export function runTokens(run: Run): { input: number; output: number; total: number } {
  const input = run.steps.reduce((sum, s) => sum + s.tokens.input, 0);
  const output = run.steps.reduce((sum, s) => sum + s.tokens.output, 0);
  return { input, output, total: input + output };
}

export function pendingGate(run: Run): Gate | undefined {
  return run.gates.find((g) => g.status === 'pending');
}

export function acceptedArtifacts(run: Run): ArtifactPath[] {
  if (run.status !== 'succeeded') return [];
  return run.steps.filter((s) => s.status === 'delivered' && s.artifactPath).map((s) => s.artifactPath as string);
}

/** Cost per accepted artifact: tokens of the run divided by its accepted artifacts (R14). */
export function costPerAcceptedArtifact(run: Run): number | null {
  const accepted = new Set(acceptedArtifacts(run)).size;
  if (accepted === 0) return null;
  return Math.round(runTokens(run).total / accepted);
}

export function isRunActive(run: Run): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'waiting-for-gate';
}
