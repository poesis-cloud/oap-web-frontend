import type { ConversationStatus, ParticipationStatus, ProposalStatus, ThreadStatus } from './lifecycles';
import type {
  ActorRef,
  ConversationId,
  GateId,
  IsoDateTime,
  MessageId,
  ProposalId,
  RunId,
  ThreadId,
  WorkspaceId,
} from './types';

/**
 * Conversations are the only collaboration data SAI owns besides workspaces (F17).
 * Runs, artifacts and journals are not conversation data: they live in the workspace.
 */

export interface Participation {
  readonly actor: ActorRef;
  readonly status: ParticipationStatus;
  readonly since: IsoDateTime;
}

export interface Thread {
  readonly id: ThreadId;
  readonly conversationId: ConversationId;
  /** null for the main thread; every conversation has exactly one main thread (F17-R9). */
  readonly parentThreadId: ThreadId | null;
  readonly openingMessageId: MessageId | null;
  readonly openedBy: ActorRef | null;
  readonly purpose: string | null;
  readonly participants: readonly ActorRef[];
  readonly status: ThreadStatus;
  readonly returnMessageId: MessageId | null;
}

/** Provenance of an agent message (R6, F1-R3). */
export interface Provenance {
  readonly agent: string;
  readonly model: string;
  readonly provider: string;
  readonly region: string;
  readonly hostingClass: 'azure-direct' | 'partner' | 'tenant-provided' | 'demo-scripted';
  readonly source: 'poesis-models-gateway' | 'tenant-provided' | 'demo-runtime';
}

export type MessageKind = 'text' | 'launch-proposal' | 'run-link' | 'gate' | 'system';

export interface Message {
  readonly id: MessageId;
  readonly threadId: ThreadId;
  readonly author: ActorRef;
  readonly kind: MessageKind;
  readonly content: string;
  readonly mentions: readonly ActorRef[];
  /** `/workflow` target, if any (F17-R4). */
  readonly targetWorkflow: string | null;
  readonly createdAt: IsoDateTime;
  readonly provenance: Provenance | null;
  readonly refs: {
    readonly proposalId?: ProposalId;
    readonly runId?: RunId;
    readonly gateId?: GateId;
    readonly childThreadId?: ThreadId;
    readonly validationConversationId?: ConversationId;
  };
  /** Streaming state of an agent answer (F1-R1); 'stopped' keeps the partial text. */
  readonly streaming: 'streaming' | 'done' | 'stopped';
}

export interface LaunchProposal {
  readonly id: ProposalId;
  readonly threadId: ThreadId;
  readonly workflowSlug: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly proposedBy: ActorRef;
  readonly decidedBy: ActorRef | null;
  readonly status: ProposalStatus;
  readonly runId: RunId | null;
  readonly createdAt: IsoDateTime;
  readonly decidedAt: IsoDateTime | null;
}

/**
 * `work`: humans and agents build artifacts through launches and consultations.
 * `validation`: opened by SAI when a ★ gate is raised; the holders of the gate role, the
 * requester and the agents of the run are invited to review the artifact and decide (F4-R3).
 */
export type ConversationKind = 'work' | 'validation';

export interface GateRef {
  readonly runId: RunId;
  readonly gateId: GateId;
  readonly artifactPath: string;
}

export interface Conversation {
  readonly id: ConversationId;
  readonly workspaceId: WorkspaceId;
  readonly kind: ConversationKind;
  /** The gate a validation conversation is about; null for work conversations. */
  readonly gateRef: GateRef | null;
  /** The workspace artifact this conversation is about, when it has one (F5-R7 "Discuss"). */
  readonly subject: string | null;
  readonly title: string;
  readonly createdBy: ActorRef;
  readonly status: ConversationStatus;
  readonly participants: readonly Participation[];
  readonly threads: readonly Thread[];
  readonly messages: readonly Message[];
  readonly proposals: readonly LaunchProposal[];
  readonly createdAt: IsoDateTime;
  readonly aiNoticeAcknowledgedBy: readonly string[];
}

export function mainThread(conversation: Conversation): Thread {
  const thread = conversation.threads.find((t) => t.parentThreadId === null);
  if (!thread) throw new Error(`Conversation ${conversation.id} has no main thread`);
  return thread;
}

export function pendingProposal(conversation: Conversation, threadId: ThreadId): LaunchProposal | undefined {
  return conversation.proposals.find((p) => p.threadId === threadId && p.status === 'proposed');
}

export function isParticipant(conversation: Conversation, actorKey: string): boolean {
  return conversation.participants.some(
    (p) =>
      p.status === 'joined' &&
      `${p.actor.kind}:${p.actor.kind === 'human' ? p.actor.userId : p.actor.slug}` === actorKey,
  );
}
