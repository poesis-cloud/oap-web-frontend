import type { Artifact, WorkItem } from '../domain/artifact';
import { artifactFileName } from '../domain/artifact';
import {
  mainThread,
  pendingProposal,
  type Conversation,
  type LaunchProposal,
  type Message,
  type MessageKind,
  type Provenance,
  type Thread,
} from '../domain/conversation';
import { CONVERSATION_TRANSITIONS, PROPOSAL_TRANSITIONS, THREAD_TRANSITIONS, transition } from '../domain/lifecycles';
import type { Notification, NotificationKind } from '../domain/notification';
import { findAgent, findWorkflow, type OrganizationPackage } from '../domain/organization';
import { isRunActive, pendingGate, type Gate, type Run } from '../domain/run';
import {
  AccessDeniedError,
  Actor,
  DomainError,
  type ActorRef,
  type ArtifactPath,
  type ConversationId,
  type GateId,
  type MessageId,
  type NotificationId,
  type ProposalId,
  type RunId,
  type ThreadId,
  type UserId,
  type WorkspaceId,
} from '../domain/types';
import { holdsRole, memberOf, type Tenant, type Workspace } from '../domain/workspace';
import type {
  AgentResponderPort,
  AgentResponse,
  Clock,
  ConversationRepository,
  GateDecision,
  IdentityPort,
  IdMinter,
  ModelGatewayPort,
  NotificationStore,
  OrganizationCatalog,
  RuntimeEvent,
  RuntimePort,
  WorkspaceReadPort,
  WorkspaceRepository,
} from '../ports';
import { deriveWorkItems, listArtifacts } from './board';
import { parseMessage } from './dispatch';

/** One dependency per mocked backend, plus the clock and the id minter. */
export interface SaiApplicationDeps {
  readonly clock: Clock;
  readonly ids: IdMinter;
  /** PIS IAM (Keycloak). */
  readonly identity: IdentityPort;
  /** Workspace manager. */
  readonly workspaces: WorkspaceRepository;
  readonly workspaceRead: WorkspaceReadPort;
  /** Conversation manager. */
  readonly conversations: ConversationRepository;
  readonly notifications: NotificationStore;
  /** Agent runtime. */
  readonly organizations: OrganizationCatalog;
  readonly runtime: RuntimePort;
  readonly responder: AgentResponderPort;
  /** Model gateway (Azure AI Foundry). */
  readonly gateway: ModelGatewayPort;
}

export interface Session {
  readonly userId: UserId;
  readonly tenantId: string;
}

export interface WaitingGate {
  readonly run: Run;
  readonly gate: Gate;
  /** The validation conversation opened for this gate, when the user takes part in it. */
  readonly conversationId: ConversationId | null;
}

/**
 * Application service of SAI: the use cases, framework-agnostic.
 *
 * Invariants enforced here, not in the UI:
 * - only a human participant confirms a launch proposal (F17-R2);
 * - only a holder of the organization-declared role decides a gate (F4-R3);
 * - humans never write to the workspace from SAI; only runs do, through the runtime (F17-R6);
 * - a workspace and its conversations are visible only to members of its tenant (F17-R7);
 * - a raised ★ gate opens a validation conversation and invites the holders of its role.
 */
export class SaiApplication {
  private readonly acknowledgedNotices = new Set<UserId>();

  constructor(private readonly deps: SaiApplicationDeps) {}

  // ---------------------------------------------------------------- reads

  tenant(session: Session): Tenant {
    const tenant = this.deps.identity.tenant(session.tenantId);
    if (!tenant || !memberOf(tenant, session.userId)) {
      throw new AccessDeniedError('No membership in this tenant');
    }
    return tenant;
  }

  workspaces(session: Session): readonly Workspace[] {
    this.tenant(session);
    return this.deps.workspaces.listByTenant(session.tenantId);
  }

  workspace(session: Session, workspaceId: WorkspaceId): Workspace {
    const workspace = this.deps.workspaces.get(workspaceId);
    if (!workspace || workspace.tenantId !== session.tenantId) {
      // Same answer whether the workspace does not exist or belongs to another tenant (F17-R7).
      throw new AccessDeniedError('Workspace not accessible');
    }
    this.tenant(session);
    return workspace;
  }

  organization(session: Session, workspaceId: WorkspaceId): OrganizationPackage {
    const workspace = this.workspace(session, workspaceId);
    const pkg = this.deps.organizations.get(workspace.organizationPackage.id);
    if (!pkg)
      throw new DomainError('organization-missing', `Package ${workspace.organizationPackage.id} is not offered`);
    return pkg;
  }

  offeredOrganizations(session: Session): readonly OrganizationPackage[] {
    this.tenant(session);
    return this.deps.organizations.offered();
  }

  conversations(session: Session, workspaceId: WorkspaceId): readonly Conversation[] {
    this.workspace(session, workspaceId);
    const me = Actor.key(Actor.human(session.userId));
    return this.deps.conversations
      .listByWorkspace(workspaceId)
      .filter((c) => c.participants.some((p) => p.status === 'joined' && Actor.key(p.actor) === me));
  }

  conversation(session: Session, conversationId: ConversationId): Conversation {
    const conversation = this.deps.conversations.get(conversationId);
    if (!conversation) throw new AccessDeniedError('Conversation not accessible');
    this.workspace(session, conversation.workspaceId);
    const me = Actor.key(Actor.human(session.userId));
    if (!conversation.participants.some((p) => p.status === 'joined' && Actor.key(p.actor) === me)) {
      throw new AccessDeniedError('Conversation not accessible');
    }
    return conversation;
  }

  /** Conversations the user takes part in that are about an artifact (subject or gate). */
  conversationsAbout(session: Session, workspaceId: WorkspaceId, path: ArtifactPath): readonly Conversation[] {
    return this.conversations(session, workspaceId).filter((c) => c.subject === path);
  }

  runs(session: Session, workspaceId: WorkspaceId): readonly Run[] {
    this.workspace(session, workspaceId);
    return [...this.deps.workspaceRead.runs(workspaceId)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  run(session: Session, runId: RunId): Run {
    const run = this.deps.runtime.run(runId);
    if (!run) throw new DomainError('run-missing', `Run ${runId} not found`);
    this.workspace(session, run.workspaceId);
    return run;
  }

  workItems(session: Session, workspaceId: WorkspaceId): WorkItem[] {
    const organization = this.organization(session, workspaceId);
    return deriveWorkItems(
      organization,
      this.deps.workspaceRead,
      workspaceId,
      this.deps.workspaceRead.runs(workspaceId),
    );
  }

  artifacts(session: Session, workspaceId: WorkspaceId): Artifact[] {
    this.workspace(session, workspaceId);
    return listArtifacts(this.deps.workspaceRead, workspaceId);
  }

  artifact(session: Session, workspaceId: WorkspaceId, path: string): Artifact | null {
    this.workspace(session, workspaceId);
    return this.deps.workspaceRead.artifact(workspaceId, path);
  }

  paths(session: Session, workspaceId: WorkspaceId): readonly ArtifactPath[] {
    this.workspace(session, workspaceId);
    return this.deps.workspaceRead.paths(workspaceId);
  }

  journal(session: Session, workspaceId: WorkspaceId) {
    this.workspace(session, workspaceId);
    return this.deps.workspaceRead.journal(workspaceId);
  }

  commits(session: Session, workspaceId: WorkspaceId) {
    this.workspace(session, workspaceId);
    return this.deps.workspaceRead.commits(workspaceId);
  }

  usageForRun(session: Session, runId: RunId) {
    this.run(session, runId);
    return this.deps.gateway.forRun(runId);
  }

  usageForTenant(session: Session) {
    this.tenant(session);
    return this.deps.gateway.forTenant(session.tenantId);
  }

  deployments(session: Session) {
    this.tenant(session);
    return this.deps.gateway.deployments(session.tenantId);
  }

  /** Gates the user may decide: holder of the declared role, run waiting (F18-R4). */
  gatesWaitingFor(session: Session, workspaceId: WorkspaceId): WaitingGate[] {
    const tenant = this.tenant(session);
    const me = Actor.key(Actor.human(session.userId));
    const validations = this.deps.conversations.listByWorkspace(workspaceId).filter((c) => c.kind === 'validation');
    return this.runs(session, workspaceId)
      .map((run) => ({ run, gate: pendingGate(run) }))
      .filter((entry): entry is { run: Run; gate: Gate } => entry.gate !== undefined)
      .filter(({ gate }) => holdsRole(tenant, session.userId, gate.holderRole))
      .map(({ run, gate }) => {
        const conversation = validations.find((c) => c.gateRef?.gateId === gate.id);
        const visible =
          conversation?.participants.some((p) => p.status === 'joined' && Actor.key(p.actor) === me) ?? false;
        return { run, gate, conversationId: visible && conversation ? conversation.id : null };
      });
  }

  /** The validation conversation of a gate, if the user takes part in it. */
  validationConversationFor(session: Session, gateId: GateId): Conversation | null {
    const run = this.runs(session, this.runWorkspace(gateId) ?? '').find((r) => r.gates.some((g) => g.id === gateId));
    if (!run) return null;
    const conversation = this.deps.conversations
      .listByWorkspace(run.workspaceId)
      .find((c) => c.gateRef?.gateId === gateId);
    if (!conversation) return null;
    try {
      return this.conversation(session, conversation.id);
    } catch {
      return null;
    }
  }

  notifications(session: Session): readonly Notification[] {
    this.tenant(session);
    return this.deps.notifications.forUser(session.userId);
  }

  unreadNotifications(session: Session): number {
    return this.notifications(session).filter((n) => n.readAt === null).length;
  }

  aiNoticeAcknowledged(userId: UserId): boolean {
    return this.acknowledgedNotices.has(userId);
  }

  acknowledgeAiNotice(userId: UserId): void {
    this.acknowledgedNotices.add(userId);
  }

  // ------------------------------------------------------------- commands

  /**
   * Starts a work conversation. `subject` links it to the artifact it is about (the explorer's
   * "Discuss this artifact"); the first message, if any, is dispatched like any other.
   */
  startConversation(
    session: Session,
    workspaceId: WorkspaceId,
    title: string,
    firstMessage: string | null,
    subject: ArtifactPath | null = null,
  ): Conversation {
    const workspace = this.workspace(session, workspaceId);
    if (workspace.status !== 'active') {
      throw new DomainError(
        'workspace-not-active',
        'An archived or provisioning workspace accepts no new conversation (F17-R8)',
      );
    }
    const organization = this.organization(session, workspaceId);
    const me = Actor.human(session.userId);
    const conversation = this.newConversation({
      workspaceId,
      kind: 'work',
      gateRef: null,
      subject,
      title: title.trim() || 'Untitled conversation',
      createdBy: me,
      participants: [me, Actor.agent(organization.dispatcher)],
    });
    this.deps.conversations.save(conversation);
    if (firstMessage && firstMessage.trim()) {
      this.postMessage(session, conversation.id, mainThread(conversation).id, firstMessage);
    }
    return this.deps.conversations.get(conversation.id) as Conversation;
  }

  renameConversation(session: Session, conversationId: ConversationId, title: string): Conversation {
    const conversation = this.conversation(session, conversationId);
    const updated = { ...conversation, title: title.trim() || conversation.title };
    this.deps.conversations.save(updated);
    return updated;
  }

  archiveConversation(session: Session, conversationId: ConversationId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const status = transition('conversation', CONVERSATION_TRANSITIONS, conversation.status, 'archived');
    // Archiving cancels open child threads (F17-R10).
    const threads = conversation.threads.map((t) =>
      t.parentThreadId !== null && (t.status === 'open' || t.status === 'waiting')
        ? { ...t, status: 'cancelled' as const }
        : t,
    );
    const updated = { ...conversation, status, threads };
    this.deps.conversations.save(updated);
    return updated;
  }

  restoreConversation(session: Session, conversationId: ConversationId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const status = transition('conversation', CONVERSATION_TRANSITIONS, conversation.status, 'open');
    const updated = { ...conversation, status };
    this.deps.conversations.save(updated);
    return updated;
  }

  invite(session: Session, conversationId: ConversationId, actor: ActorRef): Conversation {
    const conversation = this.conversation(session, conversationId);
    const tenant = this.tenant(session);
    const organization = this.organization(session, conversation.workspaceId);
    if (actor.kind === 'human' && !memberOf(tenant, actor.userId)) {
      throw new DomainError(
        'participant-not-allowed',
        'A human participant must have access to the workspace (F17-R3)',
      );
    }
    if (actor.kind === 'agent' && !findAgent(organization, actor.slug)) {
      throw new DomainError(
        'participant-not-allowed',
        'An agent participant must belong to the workspace organization (F17-R3)',
      );
    }
    const updated = this.join(conversation, actor);
    this.deps.conversations.save(updated);
    if (actor.kind === 'human' && actor.userId !== session.userId) {
      this.notify(
        [actor.userId],
        conversation.workspaceId,
        'invitation',
        `Invited to “${conversation.title}”`,
        `${this.displayName(tenant, session.userId)} invited you to a conversation.`,
        {
          conversationId: conversation.id,
        },
      );
    }
    return updated;
  }

  leave(session: Session, conversationId: ConversationId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const me = Actor.key(Actor.human(session.userId));
    const updated: Conversation = {
      ...conversation,
      participants: conversation.participants.map((p) => (Actor.key(p.actor) === me ? { ...p, status: 'left' } : p)),
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  postMessage(session: Session, conversationId: ConversationId, threadId: ThreadId, content: string): Conversation {
    const text = content.trim();
    if (!text) throw new DomainError('empty-message', 'A message needs content');
    let conversation = this.conversation(session, conversationId);
    if (conversation.status !== 'open') {
      throw new DomainError('conversation-closed', 'A closed or archived conversation accepts no new message (F17-R8)');
    }
    const thread = conversation.threads.find((t) => t.id === threadId);
    if (!thread) throw new DomainError('thread-missing', `Thread ${threadId} not found`);
    if (thread.status === 'returned' || thread.status === 'cancelled') {
      throw new DomainError('thread-closed', 'This thread has ended');
    }
    const workspace = this.workspace(session, conversation.workspaceId);
    const organization = this.organization(session, conversation.workspaceId);
    const tenant = this.tenant(session);
    const parsed = parseMessage(text, organization, tenant.members);
    const me = Actor.human(session.userId);
    const message: Message = {
      id: this.deps.ids.mint('msg'),
      threadId,
      author: me,
      kind: 'text',
      content: text,
      mentions: parsed.mentions,
      targetWorkflow: parsed.targetWorkflow,
      createdAt: this.deps.clock.now(),
      provenance: null,
      refs: {},
      streaming: 'done',
    };
    conversation = { ...conversation, messages: [...conversation.messages, message] };
    // A mention adds the agent to the participants (F17-R4).
    for (const mention of parsed.mentions) {
      if (mention.kind === 'agent') conversation = this.join(conversation, mention);
    }
    this.deps.conversations.save(conversation);

    // In a validation conversation humans talk to each other about the artifact; agents answer
    // only when addressed (R15: no free chat, and the gate decision is the human's).
    if (conversation.kind === 'validation' && parsed.addressee.kind === 'dispatcher') {
      return conversation;
    }
    const responses = this.deps.responder.respond({
      conversation,
      thread,
      message,
      workspace,
      organization,
      workItems: deriveWorkItems(
        organization,
        this.deps.workspaceRead,
        workspace.id,
        this.deps.workspaceRead.runs(workspace.id),
      ),
      addressee: parsed.addressee,
    });
    conversation = this.applyResponses(conversation, threadId, message.id, responses, organization);
    this.deps.conversations.save(conversation);
    return conversation;
  }

  /** Keeps the visible part of a streamed answer and marks it stopped (F1-R1). */
  stopGeneration(
    session: Session,
    conversationId: ConversationId,
    messageId: MessageId,
    visibleContent: string,
  ): Conversation {
    const conversation = this.conversation(session, conversationId);
    const updated: Conversation = {
      ...conversation,
      messages: conversation.messages.map((m) =>
        m.id === messageId && m.author.kind === 'agent' ? { ...m, content: visibleContent, streaming: 'stopped' } : m,
      ),
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  /** Marks a streamed answer as fully delivered. */
  completeStreaming(session: Session, conversationId: ConversationId, messageId: MessageId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const updated: Conversation = {
      ...conversation,
      messages: conversation.messages.map((m) =>
        m.id === messageId && m.streaming === 'streaming' ? { ...m, streaming: 'done' } : m,
      ),
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  openChildThread(
    session: Session,
    conversationId: ConversationId,
    fromMessageId: MessageId,
    purpose: string,
  ): Conversation {
    const conversation = this.conversation(session, conversationId);
    const opening = conversation.messages.find((m) => m.id === fromMessageId);
    if (!opening) throw new DomainError('message-missing', 'Opening message not found');
    const me = Actor.human(session.userId);
    const child: Thread = {
      id: this.deps.ids.mint('thread'),
      conversationId,
      parentThreadId: opening.threadId,
      openingMessageId: fromMessageId,
      openedBy: me,
      purpose: purpose.trim() || 'Discuss a point aside',
      participants: [me],
      status: 'open',
      returnMessageId: null,
    };
    const updated = { ...conversation, threads: [...conversation.threads, child] };
    this.deps.conversations.save(updated);
    return updated;
  }

  cancelChildThread(session: Session, conversationId: ConversationId, threadId: ThreadId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const thread = conversation.threads.find((t) => t.id === threadId);
    if (!thread || thread.parentThreadId === null)
      throw new DomainError('thread-missing', 'Only a child thread can be cancelled');
    const status = transition('thread', THREAD_TRANSITIONS, thread.status, 'cancelled');
    const notice = this.systemMessage(
      thread.parentThreadId,
      Actor.human(session.userId),
      `Child thread "${thread.purpose ?? ''}" was cancelled.`,
      {
        childThreadId: thread.id,
      },
    );
    const updated: Conversation = {
      ...conversation,
      threads: conversation.threads.map((t) => (t.id === threadId ? { ...t, status } : t)),
      messages: [...conversation.messages, notice],
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  confirmProposal(
    session: Session,
    conversationId: ConversationId,
    proposalId: ProposalId,
  ): { conversation: Conversation; run: Run } {
    const conversation = this.conversation(session, conversationId);
    const proposal = conversation.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new DomainError('proposal-missing', 'Launch proposal not found');
    const workspace = this.workspace(session, conversation.workspaceId);
    if (workspace.status !== 'active')
      throw new DomainError('workspace-not-active', 'Archived workspace: no launch (F17-R8)');
    const organization = this.organization(session, conversation.workspaceId);
    const tenant = this.tenant(session);
    const me = Actor.human(session.userId);
    const status = transition('launch proposal', PROPOSAL_TRANSITIONS, proposal.status, 'confirmed');
    const run = this.deps.runtime.launch({
      workspace,
      organization,
      proposal,
      conversationId,
      launchedBy: me,
      budgetLimitTokens: tenant.budget.limitTokens,
    });
    const now = this.deps.clock.now();
    const confirmed: LaunchProposal = { ...proposal, status, decidedBy: me, decidedAt: now, runId: run.id };
    const workflow = findWorkflow(organization, proposal.workflowSlug);
    const link: Message = {
      id: this.deps.ids.mint('msg'),
      threadId: proposal.threadId,
      author: Actor.agent(workflow?.orchestrator ?? organization.dispatcher),
      kind: 'run-link',
      content: `Run started: ${proposal.workflowSlug} (${run.workflowInstanceId}). Organization at commit ${run.organizationCommit.slice(0, 7)}.`,
      mentions: [],
      targetWorkflow: null,
      createdAt: now,
      provenance: null,
      refs: { runId: run.id, proposalId },
      streaming: 'done',
    };
    const updated: Conversation = {
      ...conversation,
      proposals: conversation.proposals.map((p) => (p.id === proposalId ? confirmed : p)),
      messages: [...conversation.messages, link],
    };
    this.deps.conversations.save(updated);
    return { conversation: updated, run };
  }

  cancelProposal(session: Session, conversationId: ConversationId, proposalId: ProposalId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const proposal = conversation.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new DomainError('proposal-missing', 'Launch proposal not found');
    const status = transition('launch proposal', PROPOSAL_TRANSITIONS, proposal.status, 'cancelled');
    const me = Actor.human(session.userId);
    const updated: Conversation = {
      ...conversation,
      proposals: conversation.proposals.map((p) =>
        p.id === proposalId ? { ...p, status, decidedBy: me, decidedAt: this.deps.clock.now() } : p,
      ),
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  /** Changing a proposal creates a new one and supersedes the pending one (F17-R2). */
  changeProposal(
    session: Session,
    conversationId: ConversationId,
    proposalId: ProposalId,
    inputs: Readonly<Record<string, string>>,
  ): Conversation {
    const conversation = this.conversation(session, conversationId);
    const previous = conversation.proposals.find((p) => p.id === proposalId);
    if (!previous) throw new DomainError('proposal-missing', 'Launch proposal not found');
    const superseded = transition('launch proposal', PROPOSAL_TRANSITIONS, previous.status, 'superseded');
    const now = this.deps.clock.now();
    const replacement: LaunchProposal = {
      ...previous,
      id: this.deps.ids.mint('proposal'),
      inputs: { ...previous.inputs, ...inputs },
      status: 'proposed',
      decidedBy: null,
      decidedAt: null,
      runId: null,
      createdAt: now,
    };
    const note: Message = {
      id: this.deps.ids.mint('msg'),
      threadId: previous.threadId,
      author: previous.proposedBy,
      kind: 'launch-proposal',
      content: `Updated launch proposal for ${previous.workflowSlug}.`,
      mentions: [],
      targetWorkflow: null,
      createdAt: now,
      provenance: null,
      refs: { proposalId: replacement.id },
      streaming: 'done',
    };
    const updated: Conversation = {
      ...conversation,
      proposals: [
        ...conversation.proposals.map((p) => (p.id === proposalId ? { ...p, status: superseded } : p)),
        replacement,
      ],
      messages: [...conversation.messages, note],
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  decideGate(
    session: Session,
    runId: RunId,
    gateId: GateId,
    decision: GateDecision,
    comment: string | null,
    reviewerSeconds: number,
  ): { run: Run; events: readonly RuntimeEvent[] } {
    const run = this.run(session, runId);
    const gate = run.gates.find((g) => g.id === gateId);
    if (!gate) throw new DomainError('gate-missing', 'Gate not found');
    const tenant = this.tenant(session);
    if (!holdsRole(tenant, session.userId, gate.holderRole)) {
      throw new AccessDeniedError(`Only a holder of the role "${gate.holderRole}" may decide this gate (F4-R3)`);
    }
    if (decision === 'rejected' && !(comment && comment.trim())) {
      throw new DomainError('comment-required', 'A rejection needs a comment the agents can act on');
    }
    const result = this.deps.runtime.decideGate({
      runId,
      gateId,
      decision,
      comment: comment?.trim() || null,
      decidedBy: Actor.human(session.userId),
      reviewerSeconds,
    });
    this.reflectEvents(result.run, result.events);
    return result;
  }

  cancelRun(session: Session, runId: RunId): { run: Run; events: readonly RuntimeEvent[] } {
    const run = this.run(session, runId);
    if (!isRunActive(run)) throw new DomainError('run-not-active', 'Only an active run can be cancelled');
    const result = this.deps.runtime.cancel(runId, Actor.human(session.userId));
    this.reflectEvents(result.run, result.events);
    return result;
  }

  /** Advances active runs one unit; the scheduler of the presentation layer calls this. */
  advanceRuns(workspaceId: WorkspaceId): readonly RuntimeEvent[] {
    const events: RuntimeEvent[] = [];
    for (const run of this.deps.workspaceRead.runs(workspaceId)) {
      if (run.status !== 'queued' && run.status !== 'running') continue;
      const result = this.deps.runtime.advance(run.id);
      this.reflectEvents(result.run, result.events);
      events.push(...result.events);
    }
    return events;
  }

  markNotificationRead(session: Session, id: NotificationId): void {
    const mine = this.notifications(session).some((n) => n.id === id);
    if (!mine) throw new AccessDeniedError('Notification not accessible');
    this.deps.notifications.markRead(id, this.deps.clock.now());
  }

  markAllNotificationsRead(session: Session): void {
    this.tenant(session);
    this.deps.notifications.markAllRead(session.userId, this.deps.clock.now());
  }

  // ------------------------------------------------------------- internals

  private runWorkspace(gateId: GateId): WorkspaceId | null {
    for (const workspace of this.allWorkspaces()) {
      if (this.deps.workspaceRead.runs(workspace.id).some((r) => r.gates.some((g) => g.id === gateId)))
        return workspace.id;
    }
    return null;
  }

  private allWorkspaces(): readonly Workspace[] {
    // The mock repositories are per tenant; the application only knows tenants through sessions,
    // so a gate lookup scans the workspaces of the tenants it has seen. Fine for a frontend mock.
    const seen = new Set<string>();
    const result: Workspace[] = [];
    for (const conversation of this.deps.conversations.listByWorkspace === undefined ? [] : []) void conversation;
    for (const tenantId of this.knownTenants) {
      for (const workspace of this.deps.workspaces.listByTenant(tenantId)) {
        if (!seen.has(workspace.id)) {
          seen.add(workspace.id);
          result.push(workspace);
        }
      }
    }
    return result;
  }

  private readonly knownTenants = new Set<string>();

  private newConversation(spec: {
    workspaceId: WorkspaceId;
    kind: Conversation['kind'];
    gateRef: Conversation['gateRef'];
    subject: ArtifactPath | null;
    title: string;
    createdBy: ActorRef;
    participants: readonly ActorRef[];
  }): Conversation {
    const now = this.deps.clock.now();
    const conversationId = this.deps.ids.mint('conv');
    const threadId = this.deps.ids.mint('thread');
    const unique = new Map(spec.participants.map((a) => [Actor.key(a), a]));
    const participants = [...unique.values()];
    return {
      id: conversationId,
      workspaceId: spec.workspaceId,
      kind: spec.kind,
      gateRef: spec.gateRef,
      subject: spec.subject,
      title: spec.title,
      createdBy: spec.createdBy,
      status: 'open',
      participants: participants.map((actor) => ({ actor, status: 'joined' as const, since: now })),
      threads: [
        {
          id: threadId,
          conversationId,
          parentThreadId: null,
          openingMessageId: null,
          openedBy: null,
          purpose: null,
          participants,
          status: 'open',
          returnMessageId: null,
        },
      ],
      messages: [],
      proposals: [],
      createdAt: now,
      aiNoticeAcknowledgedBy: [],
    };
  }

  private join(conversation: Conversation, actor: ActorRef): Conversation {
    const key = Actor.key(actor);
    const existing = conversation.participants.find((p) => Actor.key(p.actor) === key);
    const now = this.deps.clock.now();
    const participants = existing
      ? conversation.participants.map((p) => (Actor.key(p.actor) === key ? { ...p, status: 'joined' as const } : p))
      : [...conversation.participants, { actor, status: 'joined' as const, since: now }];
    const main = mainThread(conversation);
    const threads = conversation.threads.map((t) =>
      t.id === main.id && !t.participants.some((p) => Actor.key(p) === key)
        ? { ...t, participants: [...t.participants, actor] }
        : t,
    );
    return { ...conversation, participants, threads };
  }

  private agentMessage(
    threadId: ThreadId,
    agent: string,
    kind: MessageKind,
    content: string,
    provenance: Provenance,
    refs: Message['refs'] = {},
    mentions: readonly ActorRef[] = [],
  ): Message {
    return {
      id: this.deps.ids.mint('msg'),
      threadId,
      author: Actor.agent(agent),
      kind,
      content,
      mentions,
      targetWorkflow: null,
      createdAt: this.deps.clock.now(),
      provenance,
      refs,
      streaming: 'streaming',
    };
  }

  private systemMessage(
    threadId: ThreadId,
    author: ActorRef,
    content: string,
    refs: Message['refs'] = {},
    kind: MessageKind = 'system',
    at?: string,
  ): Message {
    return {
      id: this.deps.ids.mint('msg'),
      threadId,
      author,
      kind,
      content,
      mentions: [],
      targetWorkflow: null,
      createdAt: at ?? this.deps.clock.now(),
      provenance: null,
      refs,
      streaming: 'done',
    };
  }

  private applyResponses(
    input: Conversation,
    threadId: ThreadId,
    humanMessageId: MessageId,
    responses: readonly AgentResponse[],
    organization: OrganizationPackage,
  ): Conversation {
    let conversation = input;
    const consults = responses.filter((r): r is Extract<AgentResponse, { kind: 'consult' }> => r.kind === 'consult');
    for (const response of responses) {
      const provenance = this.deps.responder.provenance(response.agent, organization);
      conversation = this.join(conversation, Actor.agent(response.agent));
      switch (response.kind) {
        case 'text':
        case 'out-of-scope': {
          const mentions = response.kind === 'text' ? (response.mentions ?? []) : [];
          const message = this.agentMessage(
            threadId,
            response.agent,
            'text',
            response.content,
            provenance,
            {},
            mentions,
          );
          conversation = { ...conversation, messages: [...conversation.messages, message] };
          for (const mention of mentions) if (mention.kind === 'agent') conversation = this.join(conversation, mention);
          break;
        }
        case 'launch-proposal': {
          // At most one proposal in Proposed per thread; a new one supersedes it (F17-R2).
          const pending = pendingProposal(conversation, threadId);
          const proposal: LaunchProposal = {
            id: this.deps.ids.mint('proposal'),
            threadId,
            workflowSlug: response.workflowSlug,
            inputs: response.inputs,
            proposedBy: Actor.agent(response.agent),
            decidedBy: null,
            status: 'proposed',
            runId: null,
            createdAt: this.deps.clock.now(),
            decidedAt: null,
          };
          const message = this.agentMessage(threadId, response.agent, 'launch-proposal', response.content, provenance, {
            proposalId: proposal.id,
          });
          conversation = {
            ...conversation,
            proposals: [
              ...conversation.proposals.map((p) =>
                pending && p.id === pending.id ? { ...p, status: 'superseded' as const } : p,
              ),
              proposal,
            ],
            messages: [...conversation.messages, message],
          };
          break;
        }
        case 'consult': {
          // The opener waits in the parent thread while the child thread runs (F17-R10).
          const child: Thread = {
            id: this.deps.ids.mint('thread'),
            conversationId: conversation.id,
            parentThreadId: threadId,
            openingMessageId: humanMessageId,
            openedBy: Actor.agent(response.agent),
            purpose: response.purpose,
            participants: [Actor.agent(response.agent), Actor.agent(response.consulted)],
            status: 'open',
            returnMessageId: null,
          };
          const consultedProvenance = this.deps.responder.provenance(response.consulted, organization);
          const question = this.agentMessage(child.id, response.agent, 'text', response.purpose, provenance);
          const answer = this.agentMessage(child.id, response.consulted, 'text', response.answer, consultedProvenance);
          const returnMessage = this.agentMessage(
            threadId,
            response.agent,
            'text',
            response.returnContent,
            provenance,
            { childThreadId: child.id },
          );
          conversation = this.join(conversation, Actor.agent(response.consulted));
          conversation = {
            ...conversation,
            threads: [
              ...conversation.threads.map((t) => (t.id === threadId ? { ...t, status: 'waiting' as const } : t)),
              { ...child, status: 'returned', returnMessageId: returnMessage.id },
            ],
            messages: [...conversation.messages, question, answer, returnMessage],
          };
          break;
        }
        case 'resume': {
          const message = this.agentMessage(threadId, response.agent, 'text', response.content, provenance);
          conversation = {
            ...conversation,
            threads: conversation.threads.map((t) =>
              t.id === threadId && t.status === 'waiting' ? { ...t, status: 'open' as const } : t,
            ),
            messages: [...conversation.messages, message],
          };
          break;
        }
      }
    }
    if (consults.length > 0 && !responses.some((r) => r.kind === 'resume')) {
      conversation = {
        ...conversation,
        threads: conversation.threads.map((t) =>
          t.id === threadId && t.status === 'waiting' ? { ...t, status: 'open' as const } : t,
        ),
      };
    }
    return conversation;
  }

  /**
   * Mirrors runtime events into conversations and notifications: the launching conversation
   * gets the gate prompt and the run end; a raised ★ gate opens a validation conversation with
   * the holders of its role, the requester and the agents of the run; decisions close it.
   */
  private reflectEvents(run: Run, events: readonly RuntimeEvent[]): void {
    const launching = this.deps.conversations.get(run.conversationId);
    if (!launching) return;
    const workspace = this.deps.workspaces.get(run.workspaceId);
    const tenant = workspace ? this.deps.identity.tenant(workspace.tenantId) : undefined;
    if (tenant) this.knownTenants.add(tenant.id);
    const proposal = launching.proposals.find((p) => p.id === run.proposalId);
    const threadId = proposal?.threadId ?? mainThread(launching).id;
    const organization = this.deps.organizations.get(workspace?.organizationPackage.id ?? '');
    const workflow = organization ? findWorkflow(organization, run.workflowSlug) : undefined;
    const orchestrator = workflow?.orchestrator ?? organization?.dispatcher ?? 'copilot';
    const launcher = run.launchedBy.kind === 'human' ? run.launchedBy.userId : null;
    const messages: Message[] = [];

    for (const event of events) {
      switch (event.kind) {
        case 'gate-raised': {
          const gate = event.gate;
          messages.push(
            this.systemMessage(
              threadId,
              Actor.agent(orchestrator),
              `★ ${gate.label} is open. Review ${gate.artifactPath} and decide; the run waits.`,
              { runId: run.id, gateId: gate.id },
              'gate',
              event.at,
            ),
          );
          if (!tenant || !workspace) break;
          const holders = tenant.members.filter((m) => m.roles.includes(gate.holderRole)).map((m) => m.userId);
          const author = run.steps.find((s) => s.artifactPath === gate.artifactPath)?.actor ?? null;
          const humans = [...new Set([...holders, ...(launcher ? [launcher] : [])])];
          const validation = this.newConversation({
            workspaceId: run.workspaceId,
            kind: 'validation',
            gateRef: { runId: run.id, gateId: gate.id, artifactPath: gate.artifactPath },
            subject: gate.artifactPath,
            title: `★ ${gate.label} · ${artifactFileName(gate.artifactPath)}`,
            createdBy: Actor.agent(orchestrator),
            participants: [
              ...humans.map((u) => Actor.human(u)),
              Actor.agent(orchestrator),
              ...(author ? [Actor.agent(author)] : []),
            ],
          });
          const opening = this.systemMessage(
            mainThread(validation).id,
            Actor.agent(orchestrator),
            `Run ${run.workflowInstanceId} reached ★ ${gate.label}. Holders of the role "${gate.holderRole}" review ${gate.artifactPath} and decide here: approve, approve with a reservation, or reject with a comment the agents can act on. The run waits; nothing is auto-approved.`,
            { runId: run.id, gateId: gate.id },
            'gate',
            event.at,
          );
          this.deps.conversations.save({ ...validation, messages: [opening] });
          messages.push(
            this.systemMessage(
              threadId,
              Actor.agent(orchestrator),
              `A validation conversation “${validation.title}” was opened with ${humans.length} invited reviewer${humans.length === 1 ? '' : 's'}.`,
              {
                runId: run.id,
                gateId: gate.id,
                validationConversationId: validation.id,
              },
              'system',
              event.at,
            ),
          );
          for (const userId of humans) {
            const isHolder = holders.includes(userId);
            this.notify(
              [userId],
              run.workspaceId,
              'gate-invitation',
              `★ ${gate.label} waits for ${isHolder ? 'your decision' : 'a decision'}`,
              `${artifactFileName(gate.artifactPath)} from run ${run.workflowInstanceId}. ${isHolder ? 'You hold the role ' + gate.holderRole + '.' : 'You launched the run.'}`,
              {
                conversationId: validation.id,
                runId: run.id,
                gateId: gate.id,
                artifactPath: gate.artifactPath,
              },
              event.at,
            );
          }
          break;
        }
        case 'gate-decided': {
          const gate = event.gate;
          const text =
            gate.status === 'rejected'
              ? `Gate rejected: "${gate.comment ?? ''}". The run reroutes to rework; the comment is visible to the agents' next step.`
              : gate.status === 'approved-with-reservation'
                ? `Gate approved with a reservation: "${gate.comment ?? ''}". Recorded as a pain point with its evidence.`
                : 'Gate approved. Artifacts accepted without manual fixing (R14).';
          const by = gate.decidedBy ?? Actor.agent(orchestrator);
          messages.push(this.systemMessage(threadId, by, text, { runId: run.id, gateId: gate.id }, 'system', event.at));
          const validation = this.deps.conversations
            .listByWorkspace(run.workspaceId)
            .find((c) => c.gateRef?.gateId === gate.id);
          if (validation && validation.status === 'open') {
            const status = transition('conversation', CONVERSATION_TRANSITIONS, validation.status, 'closed');
            this.deps.conversations.save({
              ...validation,
              status,
              messages: [
                ...validation.messages,
                this.systemMessage(
                  mainThread(validation).id,
                  by,
                  `${text} This validation is closed.`,
                  { runId: run.id, gateId: gate.id },
                  'system',
                  event.at,
                ),
              ],
            });
          }
          const decider = gate.decidedBy?.kind === 'human' ? gate.decidedBy.userId : null;
          if (launcher && launcher !== decider) {
            this.notify(
              [launcher],
              run.workspaceId,
              'gate-decided',
              `★ ${gate.label} ${gate.status.replace(/-/g, ' ')}`,
              text,
              { conversationId: validation?.id, runId: run.id, gateId: gate.id },
              event.at,
            );
          }
          break;
        }
        case 'run-ended': {
          const text =
            event.status === 'succeeded'
              ? `Run ${run.workflowInstanceId} succeeded. Accepted artifacts are in the workspace.`
              : event.status === 'cancelled'
                ? `Run ${run.workflowInstanceId} was cancelled; produced artifacts are kept and marked partial.`
                : `Run ${run.workflowInstanceId} failed: ${run.failure?.message ?? 'unknown reason'}.`;
          messages.push(
            this.systemMessage(threadId, Actor.agent(orchestrator), text, { runId: run.id }, 'system', event.at),
          );
          if (launcher) {
            const kind: NotificationKind =
              event.status === 'succeeded'
                ? 'run-succeeded'
                : event.status === 'cancelled'
                  ? 'run-cancelled'
                  : 'run-failed';
            this.notify(
              [launcher],
              run.workspaceId,
              kind,
              `Run ${event.status}: ${run.workflowSlug}`,
              text,
              { conversationId: launching.id, runId: run.id },
              event.at,
            );
          }
          break;
        }
        case 'budget-alert': {
          const admins = tenant?.members.filter((m) => m.permission === 'administrator').map((m) => m.userId) ?? [];
          const targets = [...new Set([...(launcher ? [launcher] : []), ...admins])];
          this.notify(
            targets,
            run.workspaceId,
            'budget-alert',
            'Budget alert',
            `Run ${run.workflowInstanceId} used ${event.usedTokens.toLocaleString()} of ${event.limitTokens.toLocaleString()} tokens.`,
            { runId: run.id },
            event.at,
          );
          break;
        }
        default:
          break;
      }
    }
    if (messages.length > 0) {
      const current = this.deps.conversations.get(run.conversationId) ?? launching;
      this.deps.conversations.save({ ...current, messages: [...current.messages, ...messages] });
    }
  }

  private notify(
    userIds: readonly UserId[],
    workspaceId: WorkspaceId,
    kind: NotificationKind,
    title: string,
    body: string,
    refs: Notification['refs'],
    at?: string,
  ): void {
    for (const userId of userIds) {
      this.deps.notifications.push({
        id: this.deps.ids.mint('notif'),
        userId,
        workspaceId,
        kind,
        title,
        body,
        refs,
        createdAt: at ?? this.deps.clock.now(),
        readAt: null,
      });
    }
  }

  private displayName(tenant: Tenant, userId: UserId): string {
    return memberOf(tenant, userId)?.displayName ?? userId;
  }
}
