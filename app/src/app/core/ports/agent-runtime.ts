import type { WorkItem } from '../domain/artifact';
import type { Conversation, LaunchProposal, Message, Provenance, Thread } from '../domain/conversation';
import type { OrganizationPackage } from '../domain/organization';
import type { Gate, Run } from '../domain/run';
import type { ActorRef, AgentSlug, ArtifactPath, ConversationId, GateId, IsoDateTime, RunId } from '../domain/types';
import type { Workspace } from '../domain/workspace';

/**
 * Port of the **agent runtime** backend (`oap-agent-runtime`): runs of SAF workflows through
 * the harness (F4), the organization catalogue (F7) and the conversational agents that answer
 * outside runs (dispatch, consultation). Only runs write to the workspace (F17-R6).
 *
 * Mocked in `infrastructure/agent-runtime/`.
 */

export interface LaunchCommand {
  readonly workspace: Workspace;
  readonly organization: OrganizationPackage;
  readonly proposal: LaunchProposal;
  readonly conversationId: ConversationId;
  readonly launchedBy: ActorRef;
  readonly budgetLimitTokens: number;
}

export type GateDecision = 'approved' | 'approved-with-reservation' | 'rejected';

export interface DecideGateCommand {
  readonly runId: RunId;
  readonly gateId: GateId;
  readonly decision: GateDecision;
  readonly comment: string | null;
  readonly decidedBy: ActorRef;
  readonly reviewerSeconds: number;
}

export type RuntimeEvent =
  | { readonly kind: 'run-started'; readonly runId: RunId; readonly at: IsoDateTime }
  | {
      readonly kind: 'step-started';
      readonly runId: RunId;
      readonly stepSlug: string;
      readonly actor: AgentSlug;
      readonly at: IsoDateTime;
    }
  | {
      readonly kind: 'commit-gate-reverted';
      readonly runId: RunId;
      readonly stepSlug: string;
      readonly reason: string;
      readonly at: IsoDateTime;
    }
  | {
      readonly kind: 'step-delivered';
      readonly runId: RunId;
      readonly stepSlug: string;
      readonly artifactPath: ArtifactPath;
      readonly at: IsoDateTime;
    }
  | {
      readonly kind: 'budget-alert';
      readonly runId: RunId;
      readonly usedTokens: number;
      readonly limitTokens: number;
      readonly at: IsoDateTime;
    }
  | { readonly kind: 'gate-raised'; readonly runId: RunId; readonly gate: Gate; readonly at: IsoDateTime }
  | { readonly kind: 'gate-decided'; readonly runId: RunId; readonly gate: Gate; readonly at: IsoDateTime }
  | { readonly kind: 'run-ended'; readonly runId: RunId; readonly status: Run['status']; readonly at: IsoDateTime };

/** Runs (F4): launch, advance, decide a gate, cancel. */
export interface RuntimePort {
  launch(command: LaunchCommand): Run;
  /** Advances one deterministic unit of work; returns the run and what became observable. */
  advance(runId: RunId): { readonly run: Run; readonly events: readonly RuntimeEvent[] };
  decideGate(command: DecideGateCommand): { readonly run: Run; readonly events: readonly RuntimeEvent[] };
  cancel(runId: RunId, by: ActorRef): { readonly run: Run; readonly events: readonly RuntimeEvent[] };
  run(runId: RunId): Run | undefined;
}

/** Organization packages hosted by the runtime (F7, F18-R5). */
export interface OrganizationCatalog {
  offered(): readonly OrganizationPackage[];
  get(id: string): OrganizationPackage | undefined;
}

export type Addressee =
  | { readonly kind: 'dispatcher'; readonly agent: AgentSlug }
  | { readonly kind: 'agent'; readonly agent: AgentSlug }
  | { readonly kind: 'workflow'; readonly workflowSlug: string; readonly agent: AgentSlug };

export interface ResponseContext {
  readonly conversation: Conversation;
  readonly thread: Thread;
  readonly message: Message;
  readonly workspace: Workspace;
  readonly organization: OrganizationPackage;
  readonly workItems: readonly WorkItem[];
  readonly runs: readonly Run[];
  readonly addressee: Addressee;
  /** The ★ gate this conversation waits on, when the orchestrator is addressed during a gate. */
  readonly pendingGate?: Gate;
}

/** What an agent does with a human message, outside runs: answer in scope, propose a launch, consult, or decline. */
export type AgentResponse =
  | {
      readonly kind: 'text';
      readonly agent: AgentSlug;
      readonly content: string;
      readonly mentions?: readonly ActorRef[];
    }
  | {
      readonly kind: 'out-of-scope';
      readonly agent: AgentSlug;
      readonly content: string;
      readonly suggestions: readonly string[];
    }
  | {
      readonly kind: 'launch-proposal';
      readonly agent: AgentSlug;
      readonly content: string;
      readonly workflowSlug: string;
      readonly inputs: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'consult';
      readonly agent: AgentSlug;
      readonly consulted: AgentSlug;
      readonly purpose: string;
      readonly answer: string;
      readonly returnContent: string;
    }
  | { readonly kind: 'resume'; readonly agent: AgentSlug; readonly content: string };

/** The conversational agents outside runs. A model call through the gateway in production; scripted in the mock. */
export interface AgentResponderPort {
  respond(context: ResponseContext): readonly AgentResponse[];
  /** Provenance of an agent message produced by this responder (R6). */
  provenance(agent: AgentSlug, organization: OrganizationPackage): Provenance;
}
