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
  WorkspaceProvisioner,
} from '../ports';
import { parseArtifact } from '../saf/frontmatter';
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
  readonly provisioner: WorkspaceProvisioner;
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
  /** The conversation the gate lives in (the one that launched the run), when the user takes part in it. */
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
 * - a raised ★ gate is the orchestrator's message in the launching conversation; the holders of
 *   its role are invited there and decide there (Clément, 2026-11-09);
 * - every worker session of a run is a conversation of its own (one session = one conversation).
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

  /** The gateway's price for a model (euros per million tokens), for cost figures (F3). */
  priceOf(session: Session, model: string) {
    this.tenant(session);
    return this.deps.gateway.priceOf(model);
  }

  /** The clock the runtime uses, so that durations of active runs are measured consistently. */
  now() {
    return this.deps.clock.now();
  }

  /** Gates the user may decide: holder of the declared role, run waiting (F18-R4). */
  gatesWaitingFor(session: Session, workspaceId: WorkspaceId): WaitingGate[] {
    const tenant = this.tenant(session);
    const me = Actor.key(Actor.human(session.userId));
    return this.runs(session, workspaceId)
      .map((run) => ({ run, gate: pendingGate(run) }))
      .filter((entry): entry is { run: Run; gate: Gate } => entry.gate !== undefined)
      .filter(({ gate }) => holdsRole(tenant, session.userId, gate.holderRole))
      .map(({ run, gate }) => {
        const conversation = this.deps.conversations.get(run.conversationId);
        const visible =
          conversation?.participants.some((p) => p.status === 'joined' && Actor.key(p.actor) === me) ?? false;
        return { run, gate, conversationId: visible && conversation ? conversation.id : null };
      });
  }

  /** The conversation a gate lives in (the run's launching conversation), if the user takes part in it. */
  gateConversationFor(session: Session, gateId: GateId): Conversation | null {
    const run = this.runs(session, this.runWorkspace(gateId) ?? '').find((r) => r.gates.some((g) => g.id === gateId));
    if (!run) return null;
    try {
      return this.conversation(session, run.conversationId);
    } catch {
      return null;
    }
  }

  /** The worker session conversation of a run step, if any (one session = one conversation). */
  sessionConversation(session: Session, runId: RunId, stepSlug: string): Conversation | null {
    const run = this.run(session, runId);
    const found = this.deps.conversations
      .listByWorkspace(run.workspaceId)
      .find(
        (c) =>
          c.sessionRef?.runId === runId &&
          c.sessionRef.sessionId === run.steps.find((s) => s.stepSlug === stepSlug)?.sessionId,
      );
    if (!found) return null;
    try {
      return this.conversation(session, found.id);
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

  createWorkspace(session: Session, name: string, packageId: string): Workspace {
    this.tenant(session);
    const title = name.trim();
    if (!title || title.length > 80)
      throw new DomainError('workspace-name', 'Use a workspace name of 1–80 characters.');
    if (this.workspaces(session).some((w) => w.name.toLowerCase() === title.toLowerCase()))
      throw new DomainError('workspace-exists', 'A workspace already uses this name in your tenant.');
    const organization = this.deps.organizations.get(packageId);
    if (!organization)
      throw new DomainError('organization-missing', 'Choose an organization offered by this instance.');
    return this.deps.provisioner.create({
      id: this.deps.ids.mint('ws'),
      tenantId: session.tenantId,
      name: title,
      organization,
    });
  }

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
      sessionRef: null,
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

    // Who answers when nobody is addressed: in a session conversation, the session's agent; in a
    // conversation whose run waits at a ★ gate, the orchestrator of that run; otherwise Copilot.
    let addressee = parsed.addressee;
    const waitingRun = this.deps.workspaceRead
      .runs(workspace.id)
      .find((r) => r.conversationId === conversation.id && pendingGate(r));
    let gateWaiting: Gate | undefined = waitingRun ? pendingGate(waitingRun) : undefined;
    if (addressee.kind === 'dispatcher') {
      if (conversation.sessionRef) {
        addressee = { kind: 'agent', agent: conversation.sessionRef.agent };
      } else {
        const runs = this.deps.workspaceRead.runs(workspace.id).filter((r) => r.conversationId === conversation.id);
        const waiting = runs.find((r) => pendingGate(r) !== undefined);
        if (waiting) {
          gateWaiting = pendingGate(waiting);
          const orchestrator = findWorkflow(organization, waiting.workflowSlug)?.orchestrator;
          if (orchestrator) addressee = { kind: 'agent', agent: orchestrator };
        }
      }
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
      addressee,
      runs: this.deps.workspaceRead.runs(workspace.id),
      pendingGate: gateWaiting,
    });
    conversation = this.applyResponses(conversation, threadId, message.id, responses, organization);
    const actors = [me, ...responses.map((r) => Actor.agent(r.agent))];
    conversation = {
      ...conversation,
      threads: conversation.threads.map((t) =>
        t.id === threadId
          ? { ...t, participants: [...new Map([...t.participants, ...actors].map((a) => [Actor.key(a), a])).values()] }
          : t,
      ),
    };
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
    if (conversation.status !== 'open')
      throw new DomainError('conversation-closed', 'Restore the conversation before opening a thread.');
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
      participants: [me, opening.author],
      status: 'open',
      returnMessageId: null,
    };
    const updated = { ...conversation, threads: [...conversation.threads, child] };
    this.deps.conversations.save(updated);
    return updated;
  }

  returnChildThread(session: Session, conversationId: string, threadId: string, summary: string): Conversation {
    const conversation = this.conversation(session, conversationId);
    if (conversation.status !== 'open') throw new DomainError('conversation-closed', 'Restore the conversation first.');
    const thread = conversation.threads.find((t) => t.id === threadId);
    if (!thread || !thread.parentThreadId) throw new DomainError('thread-missing', 'Select a child thread.');
    if (
      conversation.proposals.some(
        (p) =>
          p.threadId === threadId && (p.status === 'proposed' || (p.runId && isRunActive(this.run(session, p.runId)))),
      )
    )
      throw new DomainError(
        'thread-running',
        'Finish or cancel the launch proposal and run before returning this thread.',
      );
    if (!summary.trim())
      throw new DomainError('summary-required', 'Write a conclusion to return to the parent thread.');
    if (
      conversation.threads.some((t) => t.parentThreadId === threadId && (t.status === 'open' || t.status === 'waiting'))
    )
      throw new DomainError('thread-waiting', 'Return or cancel the nested threads first.');
    const status = transition('thread', THREAD_TRANSITIONS, thread.status, 'returned');
    const message = this.systemMessage(
      thread.parentThreadId,
      Actor.human(session.userId),
      summary.trim(),
      { childThreadId: thread.id },
      'text',
    );
    const updated = {
      ...conversation,
      threads: conversation.threads.map((t) => (t.id === threadId ? { ...t, status, returnMessageId: message.id } : t)),
      messages: [...conversation.messages, message],
    };
    this.deps.conversations.save(updated);
    return updated;
  }

  startRetrospective(session: Session, workspaceId: string): Conversation {
    const pains = this.workItems(session, workspaceId).filter(
      (i) => i.type === 'pain-point' && ['open', 'triaged'].includes(i.status),
    );
    if (!pains.length) throw new DomainError('no-pain-points', 'Record a pain point before starting a retrospective.');
    let conversation = this.startConversation(
      session,
      workspaceId,
      `Retrospective · ${pains.length} pain point${pains.length > 1 ? 's' : ''} · ${this.deps.clock.now().slice(0, 10)}`,
      null,
    );
    const organization = this.organization(session, workspaceId);
    conversation = this.join(conversation, Actor.agent('release-train-engineer'));
    const intro = this.agentMessage(
      mainThread(conversation).id,
      'release-train-engineer',
      'text',
      'Let us examine each pain point in its own thread. Compare the evidence, agree on an action and return a conclusion here. An organization change is a separate run, confirmed by a human and reviewed at its gate.',
      this.deps.responder.provenance('release-train-engineer', organization),
    );
    const messages = [intro];
    const threads: Thread[] = [];
    for (const pain of pains) {
      const opening = this.agentMessage(
        mainThread(conversation).id,
        'release-train-engineer',
        'text',
        pain.title,
        this.deps.responder.provenance('release-train-engineer', organization),
        { artifactPath: pain.path },
      );
      messages.push(opening);
      const thread: Thread = {
        id: this.deps.ids.mint('thread'),
        conversationId: conversation.id,
        parentThreadId: mainThread(conversation).id,
        openingMessageId: opening.id,
        openedBy: Actor.agent('release-train-engineer'),
        purpose: pain.title,
        participants: [Actor.human(session.userId), Actor.agent('release-train-engineer')],
        status: 'open',
        returnMessageId: null,
      };
      threads.push(thread);
      messages.push(
        this.agentMessage(
          thread.id,
          'release-train-engineer',
          'text',
          this.painPointBrief(workspaceId, pain.path),
          this.deps.responder.provenance('release-train-engineer', organization),
          { artifactPath: pain.path },
        ),
      );
    }
    conversation = {
      ...conversation,
      threads: [...conversation.threads, ...threads],
      messages: [...conversation.messages, ...messages],
    };
    this.deps.conversations.save(conversation);
    return conversation;
  }

  /** What the RTE opens a retrospective thread with: the pain point's own evidence, never a fixed story. */
  private painPointBrief(workspaceId: WorkspaceId, path: ArtifactPath): string {
    const content = this.deps.workspaceRead.read(workspaceId, path);
    const fm = content ? parseArtifact(content).frontmatter : {};
    const text = (key: string) => (typeof fm[key] === 'string' ? (fm[key] as string) : null);
    const symptom = text('symptom') ?? 'the friction recorded on this pain point';
    const origin = text('origin');
    const sourceRun = text('sourceRun');
    const target = text('targetArtifact');
    const where = sourceRun
      ? ` (run ${sourceRun}${origin ? `, origin ${origin}` : ''})`
      : origin
        ? ` (origin ${origin})`
        : '';
    const next = target
      ? `A candidate change targets ${artifactFileName(target)}; say whether it is the right fix.`
      : 'No target artifact yet: say whether this is a workflow improvement, a product improvement, accepted as is, or a duplicate.';
    return `Evidence: ${symptom}${where}. ${next} Review the pain point, then return your conclusion to the parent thread; an accepted change still needs observation before this pain point can be considered resolved.`;
  }

  cancelChildThread(session: Session, conversationId: ConversationId, threadId: ThreadId): Conversation {
    const conversation = this.conversation(session, conversationId);
    const thread = conversation.threads.find((t) => t.id === threadId);
    if (!thread || thread.parentThreadId === null)
      throw new DomainError('thread-missing', 'Only a child thread can be cancelled');
    if (conversation.status !== 'open') throw new DomainError('conversation-closed', 'Restore the conversation first.');
    const status = transition('thread', THREAD_TRANSITIONS, thread.status, 'cancelled');
    const notice = this.systemMessage(
      thread.parentThreadId,
      Actor.human(session.userId),
      `Child thread "${thread.purpose ?? ''}" was cancelled.`,
      {
        childThreadId: thread.id,
      },
    );
    const cancelled = new Set([threadId]);
    for (let i = 0; i < conversation.threads.length; i++)
      for (const t of conversation.threads)
        if (t.parentThreadId && cancelled.has(t.parentThreadId) && (t.status === 'open' || t.status === 'waiting'))
          cancelled.add(t.id);
    const updated: Conversation = {
      ...conversation,
      threads: conversation.threads.map((t) => (cancelled.has(t.id) ? { ...t, status } : t)),
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
    if (conversation.status !== 'open')
      throw new DomainError('conversation-closed', 'Restore the conversation before acting on a proposal.');
    const proposal = conversation.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new DomainError('proposal-missing', 'Launch proposal not found');
    const thread = conversation.threads.find((t) => t.id === proposal.threadId);
    if (!thread || !['open', 'waiting'].includes(thread.status))
      throw new DomainError('thread-closed', 'This proposal belongs to a closed thread.');
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
    if (conversation.status !== 'open')
      throw new DomainError('conversation-closed', 'Restore the conversation before acting on a proposal.');
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
    if ((decision === 'rejected' || decision === 'approved-with-reservation') && !(comment && comment.trim())) {
      throw new DomainError('comment-required', 'A rejection or reservation needs an actionable comment');
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
    sessionRef: Conversation['sessionRef'];
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
      sessionRef: spec.sessionRef,
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
   * Mirrors runtime events into conversations and notifications. The launching conversation is
   * the orchestrator's session: it gets a notice per step (linking the worker session
   * conversation), the ★ gate as the orchestrator's message awaiting a decision (holders of the
   * role are invited there and notified) and the run end. Each worker session is a conversation
   * where the agent exposes its reasoning (one session = one conversation).
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
        case 'step-started': {
          const step = run.steps.find((st) => st.stepSlug === event.stepSlug);
          if (!step || !organization) break;
          const agentName = findAgent(organization, event.actor)?.name ?? event.actor;
          const definition = workflow?.steps.find((st) => st.slug === event.stepSlug);
          const sessionConversation = this.newConversation({
            workspaceId: run.workspaceId,
            kind: 'session',
            sessionRef: { runId: run.id, sessionId: step.sessionId, stepSlug: step.stepSlug, agent: event.actor },
            subject: null,
            title: `${step.stepSlug} · ${agentName}`,
            createdBy: Actor.agent(event.actor),
            participants: [
              Actor.agent(event.actor),
              Actor.agent(orchestrator),
              ...launching.participants
                .filter((p) => p.status === 'joined' && p.actor.kind === 'human')
                .map((p) => p.actor),
            ],
          });
          const attempt = step.attempt > 1 ? ` This is attempt ${step.attempt}, after the gate asked for rework.` : '';
          const opening = this.systemMessage(
            mainThread(sessionConversation).id,
            Actor.agent(event.actor),
            `Session ${step.sessionId} started for step ${step.stepSlug} of ${run.workflowInstanceId}. I produce one ${definition?.artifact ?? 'artifact'} from ${definition?.description ? definition.description.trim() : 'the workflow inputs'}.${attempt} Ask me here if you want to steer the work; the harness checks everything I write before it becomes workspace state.`,
            { runId: run.id },
            'text',
            event.at,
          );
          this.deps.conversations.save({ ...sessionConversation, messages: [opening] });
          messages.push(
            this.systemMessage(
              threadId,
              Actor.agent(orchestrator),
              `Step ${step.stepSlug} started: ${agentName} works in its own session.`,
              { runId: run.id, sessionConversationId: sessionConversation.id },
              'system',
              event.at,
            ),
          );
          break;
        }
        case 'commit-gate-reverted': {
          this.appendToSession(run, event.stepSlug, (agent) =>
            this.systemMessage(
              '',
              Actor.agent(agent),
              `The harness rejected my write: ${event.reason}. I correct the artifact and retry.`,
              { runId: run.id },
              'text',
              event.at,
            ),
          );
          break;
        }
        case 'step-delivered': {
          const step = run.steps.find((st) => st.stepSlug === event.stepSlug);
          this.appendToSession(
            run,
            event.stepSlug,
            (agent) =>
              this.systemMessage(
                '',
                Actor.agent(agent),
                `Delivered ${artifactFileName(event.artifactPath)}${step?.commitSha ? ` (commit ${step.commitSha.slice(0, 7)})` : ''}: the harness validated it against its contract. Session ended.`,
                { runId: run.id, artifactPath: event.artifactPath },
                'text',
                event.at,
              ),
            event.artifactPath,
          );
          break;
        }
        case 'gate-raised': {
          const gate = event.gate;
          if (!tenant || !workspace) break;
          const holders = tenant.members.filter((m) => m.roles.includes(gate.holderRole)).map((m) => m.userId);
          const humans = [...new Set([...holders, ...(launcher ? [launcher] : [])])];
          // The gate is the orchestrator's answer at the end of the workflow, in this conversation.
          messages.push(
            this.systemMessage(
              threadId,
              Actor.agent(orchestrator),
              `The workflow steps are complete; the run waits at ★ ${gate.label}. Holders of the role "${gate.holderRole}": review ${artifactFileName(gate.artifactPath)} and decide here, to close the workflow: approve, approve with a reservation, or reject with a comment the agents will act on. Nothing is auto-approved.`,
              { runId: run.id, gateId: gate.id, artifactPath: gate.artifactPath },
              'gate',
              event.at,
            ),
          );
          // Holders join the conversation and are notified; the launcher already takes part.
          let current = this.deps.conversations.get(run.conversationId) ?? launching;
          for (const userId of holders) current = this.join(current, Actor.human(userId));
          this.deps.conversations.save(current);
          for (const userId of humans) {
            const isHolder = holders.includes(userId);
            this.notify(
              [userId],
              run.workspaceId,
              'gate-invitation',
              `★ ${gate.label} waits for ${isHolder ? 'your decision' : 'a decision'}`,
              `${artifactFileName(gate.artifactPath)} from run ${run.workflowInstanceId}. ${isHolder ? 'You hold the role ' + gate.holderRole + '.' : 'You launched the run.'}`,
              { conversationId: run.conversationId, runId: run.id, gateId: gate.id, artifactPath: gate.artifactPath },
              event.at,
            );
          }
          break;
        }
        case 'gate-decided': {
          const gate = event.gate;
          const file = artifactFileName(gate.artifactPath);
          const decider = gate.decidedBy ?? Actor.agent(orchestrator);
          const verb =
            gate.status === 'rejected'
              ? 'Rejected'
              : gate.status === 'approved-with-reservation'
                ? 'Approved with a reservation'
                : 'Approved';
          // The decision is the human's own message in the conversation (Clément, 2026-11-09: roles were inverted
          // when a system line spoke in the decider's name); the orchestrator then says what it does with it.
          const words = gate.comment ? `${verb}: ${gate.comment}` : `${verb}.`;
          messages.push(
            this.systemMessage(
              threadId,
              decider,
              words,
              { runId: run.id, gateId: gate.id, artifactPath: gate.artifactPath },
              'decision',
              event.at,
            ),
          );
          const reworkStep = workflow?.gate?.reworkStep ?? run.steps[0]?.stepSlug ?? '';
          const reworkActor = workflow?.steps.find((st) => st.slug === reworkStep)?.actor ?? run.steps[0]?.actor ?? '';
          const reply =
            gate.status === 'rejected'
              ? `Understood. I send ${file} back to @${reworkActor} for rework with your comment; the harness checks the new revision and I raise a new ★ ${gate.label} here when it is delivered.`
              : gate.status === 'approved-with-reservation'
                ? `Thank you. ${file} is accepted as reviewed, and I record your reservation as a pain point with this run as evidence, for the next retrospective.`
                : `Thank you. ${file} is accepted as reviewed; the run closes and the workspace moves on.`;
          messages.push({
            ...this.systemMessage(
              threadId,
              Actor.agent(orchestrator),
              reply,
              { runId: run.id, gateId: gate.id },
              'text',
              event.at,
            ),
            provenance: organization ? this.deps.responder.provenance(orchestrator, organization) : null,
          });
          const decidedBy = gate.decidedBy?.kind === 'human' ? gate.decidedBy.userId : null;
          if (launcher && launcher !== decidedBy) {
            this.notify(
              [launcher],
              run.workspaceId,
              'gate-decided',
              `★ ${gate.label} ${gate.status.replace(/-/g, ' ')}`,
              `${tenant ? this.displayName(tenant, decidedBy ?? '') : (decidedBy ?? 'A holder')}: ${words}`,
              { conversationId: run.conversationId, runId: run.id, gateId: gate.id },
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

  /** Appends the agent's own message to the worker session conversation of a step. */
  private appendToSession(
    run: Run,
    stepSlug: string,
    build: (agent: string) => Message,
    subject: ArtifactPath | null = null,
  ): void {
    const conversation = this.deps.conversations
      .listByWorkspace(run.workspaceId)
      .find(
        (c) =>
          c.sessionRef?.runId === run.id &&
          c.sessionRef.sessionId === run.steps.find((s) => s.stepSlug === stepSlug)?.sessionId,
      );
    if (!conversation) return;
    const message = { ...build(conversation.sessionRef!.agent), threadId: mainThread(conversation).id };
    this.deps.conversations.save({
      ...conversation,
      subject: subject ?? conversation.subject,
      messages: [...conversation.messages, message],
    });
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
