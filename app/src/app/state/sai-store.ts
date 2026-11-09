import { computed, inject, Injectable, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import {
  analyzeSubjects,
  runMetrics,
  stepMetrics,
  sumCost,
  summarizeWorkflows,
  type RunMetrics,
  type StepMetrics,
} from '../core/application/analysis';
import { gapToNominal, organizationHistory, ORGANIZATION_ROOT } from '../core/application/organization-view';
import type { Session } from '../core/application/sai-application';
import { buildWorkspaceTree } from '../core/application/workspace-tree';
import type { Conversation } from '../core/domain/conversation';
import { isRunActive, type Gate, type Run } from '../core/domain/run';
import { holdsRole } from '../core/domain/workspace';
import { DomainError, type ActorRef } from '../core/domain/types';
import type { GateDecision, RuntimeEvent } from '../core/ports';
import { createMockWorld, DEMO_WORKSPACE_ID, INSTANCE, type MockWorld } from '../infrastructure/mock-world';
import { OrganizationSourcesHolder } from './organization-sources-holder';

const TICK_MS = 900;
const STREAM_CHARS_PER_FRAME = 9;
const STREAM_FRAME_MS = 24;

/**
 * Presentation-side store: a thin signal facade over the application service.
 *
 * The application owns the rules; this store only re-reads views after each command (the
 * `version` signal), drives the mock scheduler that advances runs, simulates the streaming
 * of agent answers and turns runtime events and typed errors into toasts.
 */
@Injectable({ providedIn: 'root' })
export class SaiStore {
  private readonly messages = inject(MessageService);
  private readonly world: MockWorld = createMockWorld({ sources: inject(OrganizationSourcesHolder).sources });
  private readonly version = signal(0);
  private readonly streamProgress = signal<Record<string, number>>({});
  private readonly streamTimers = new Map<string, ReturnType<typeof setInterval>>();
  private scheduler: ReturnType<typeof setInterval> | null = null;

  /** All five backends are in-browser mocks in this build (shown as a discreet "demo" chip). */
  readonly mockBackends = true;
  /** The instance this build stands for: the Specialized configuration serving the SAFe pack. */
  readonly instance = INSTANCE;
  readonly session = signal<Session>(this.world.session);
  readonly workspaceId = signal<string>(DEMO_WORKSPACE_ID);
  readonly runsPaused = signal(false);

  readonly app = this.world.app;

  readonly tenant = computed(() => (this.version(), this.app.tenant(this.session())));
  readonly me = computed(() => this.tenant().members.find((m) => m.userId === this.session().userId));
  readonly workspaces = computed(() => (this.version(), this.app.workspaces(this.session())));
  readonly workspace = computed(() => (this.version(), this.app.workspace(this.session(), this.workspaceId())));
  readonly organization = computed(() => (this.version(), this.app.organization(this.session(), this.workspaceId())));
  readonly conversations = computed(() => (this.version(), this.app.conversations(this.session(), this.workspaceId())));
  readonly runs = computed(() => (this.version(), this.app.runs(this.session(), this.workspaceId())));
  readonly activeRuns = computed(() => this.runs().filter((r) => isRunActive(r)));
  readonly workItems = computed(() => (this.version(), this.app.workItems(this.session(), this.workspaceId())));
  readonly artifacts = computed(() => (this.version(), this.app.artifacts(this.session(), this.workspaceId())));
  readonly paths = computed(() => (this.version(), this.app.paths(this.session(), this.workspaceId())));
  /** Every path of the workspace laid on the structure map, the organization folder included (browsed in the explorer). */
  readonly tree = computed(() => buildWorkspaceTree(this.organization().workspaceStructure, this.paths()));
  readonly organizationFileCount = computed(() => this.paths().filter((p) => p.startsWith(`${ORGANIZATION_ROOT}/`)).length);
  readonly organizationHistory = computed(() =>
    organizationHistory(this.commits(), this.workspace().nominalImportCommit),
  );
  readonly organizationGap = computed(() => gapToNominal(this.commits(), this.workspace().nominalImportCommit));
  readonly journal = computed(() => (this.version(), this.app.journal(this.session(), this.workspaceId())));
  readonly commits = computed(() => (this.version(), this.app.commits(this.session(), this.workspaceId())));
  readonly gatesWaitingForMe = computed(
    () => (this.version(), this.app.gatesWaitingFor(this.session(), this.workspaceId())),
  );
  readonly offeredOrganizations = computed(() => (this.version(), this.app.offeredOrganizations(this.session())));
  readonly tenantUsage = computed(() => (this.version(), this.app.usageForTenant(this.session())));
  readonly tenantTokens = computed(() => this.tenantUsage().reduce((sum, u) => sum + u.tokensIn + u.tokensOut, 0));
  /** Euros the gateway would invoice the tenant for this session (F3). */
  readonly tenantCost = computed(() => sumCost(this.tenantUsage(), this.priceOf));
  /** Cost and time of every run of the workspace (Clément, 2026-11-08). */
  readonly runMetrics = computed((): RunMetrics[] =>
    this.runs().map((run) => runMetrics(run, this.app.usageForRun(this.session(), run.id), this.priceOf, this.app.now())),
  );
  readonly workflowSummary = computed(() => summarizeWorkflows(this.runMetrics()));
  /** End-to-end analysis by subject (work item) across workflows and runs. */
  readonly subjects = computed(() =>
    analyzeSubjects(
      this.runs(),
      this.workItems(),
      (runId) => this.app.usageForRun(this.session(), runId),
      this.priceOf,
      this.app.now(),
    ),
  );
  readonly deployments = computed(() => (this.version(), this.app.deployments(this.session())));
  readonly aiNoticeAcknowledged = computed(
    () => (this.version(), this.app.aiNoticeAcknowledged(this.session().userId)),
  );
  readonly notifications = computed(() => (this.version(), this.app.notifications(this.session())));
  readonly unreadCount = computed(() => this.notifications().filter((n) => n.readAt === null).length);
  readonly waitingCount = computed(
    () => this.gatesWaitingForMe().length + this.runs().filter((r) => r.status === 'failed').length,
  );

  constructor() {
    this.startScheduler();
  }

  // ----------------------------------------------------------------- reads

  conversation(id: string): Conversation | null {
    this.version();
    try {
      return this.app.conversation(this.session(), id);
    } catch {
      return null;
    }
  }

  run(id: string): Run | null {
    this.version();
    try {
      return this.app.run(this.session(), id);
    } catch {
      return null;
    }
  }

  usageForRun(runId: string) {
    this.version();
    return this.app.usageForRun(this.session(), runId);
  }

  readonly priceOf = (model: string) => this.app.priceOf(this.session(), model);

  /** How the current user relates to a gate (Supervision › Gates filters, 2026-11-09). */
  myRoleInGate(run: Run, gate: Gate): 'holder' | 'requester' | 'participant' | 'observer' {
    const me = this.session().userId;
    if (holdsRole(this.tenant(), me, gate.holderRole)) return 'holder';
    if (run.launchedBy.kind === 'human' && run.launchedBy.userId === me) return 'requester';
    const conversation = this.validationConversationFor(gate.id);
    if (conversation?.participants.some((p) => p.status === 'joined' && p.actor.kind === 'human' && p.actor.userId === me)) return 'participant';
    return 'observer';
  }

  /** How the current user relates to a run (Supervision › Runs filters). */
  myRoleInRun(run: Run): 'launcher' | 'holder' | 'participant' | 'observer' {
    const me = this.session().userId;
    if (run.launchedBy.kind === 'human' && run.launchedBy.userId === me) return 'launcher';
    if (run.gates.some((g) => holdsRole(this.tenant(), me, g.holderRole))) return 'holder';
    const conversation = this.conversation(run.conversationId);
    if (conversation?.participants.some((p) => p.status === 'joined' && p.actor.kind === 'human' && p.actor.userId === me)) return 'participant';
    return 'observer';
  }

  /** Harness log entries of one session (orchestrator or worker), in order. */
  sessionLog(sessionId: string) {
    this.version();
    return this.journal().filter((e) => e.report.context.sessionId === sessionId);
  }

  metricsOf(run: Run): RunMetrics {
    this.version();
    return runMetrics(run, this.app.usageForRun(this.session(), run.id), this.priceOf, this.app.now());
  }

  stepMetricsOf(run: Run): StepMetrics[] {
    this.version();
    return stepMetrics(run, this.app.usageForRun(this.session(), run.id), this.priceOf, this.app.now());
  }

  conversationsAbout(path: string): readonly Conversation[] {
    this.version();
    try {
      return this.app.conversationsAbout(this.session(), this.workspaceId(), path);
    } catch {
      return [];
    }
  }

  validationConversationFor(gateId: string): Conversation | null {
    this.version();
    try {
      return this.app.validationConversationFor(this.session(), gateId);
    } catch {
      return null;
    }
  }

  /** Visible length of a streaming agent message; undefined once fully shown. */
  streamedLength(messageId: string): number | undefined {
    return this.streamProgress()[messageId];
  }

  // -------------------------------------------------------------- commands

  startConversation(title: string, firstMessage: string | null, subject: string | null = null): Conversation | null {
    return this.command(() => {
      const conversation = this.app.startConversation(this.session(), this.workspaceId(), title, firstMessage, subject);
      this.streamNewAgentMessages(conversation, []);
      return conversation;
    });
  }

  /**
   * Organization actions never execute directly: each opens a conversation with the
   * orchestrator about the organization folder (F16-R11).
   */
  proposeOrganizationAction(kind: 'change' | 'upgrade' | 'rollback' | 'poesis'): Conversation | null {
    const texts: Record<typeof kind, { title: string; message: string }> = {
      change: {
        title: 'Organization change proposal',
        message: 'I propose a change to the organization: adjust the author-adr step instructions so that ADRs name the partner authentication mode explicitly.',
      },
      upgrade: {
        title: 'Organization upgrade proposal',
        message: 'I propose to upgrade the organization to the next version of the SAFe package.',
      },
      rollback: {
        title: 'Organization rollback proposal',
        message: 'I propose a rollback of the last organization change.',
      },
      poesis: {
        title: 'Propose an organization change to Poesis',
        message: 'I propose to send our organization change to Poesis for the next package version, with our consent for this change only.',
      },
    };
    const { title, message } = texts[kind];
    return this.startConversation(title, message, `${ORGANIZATION_ROOT}/`);
  }

  postMessage(conversationId: string, threadId: string, content: string): void {
    this.command(() => {
      const before = this.app.conversation(this.session(), conversationId);
      const after = this.app.postMessage(this.session(), conversationId, threadId, content);
      this.streamNewAgentMessages(
        after,
        before.messages.map((m) => m.id),
      );
    });
  }

  stopGeneration(conversationId: string, messageId: string): void {
    const conversation = this.conversation(conversationId);
    const message = conversation?.messages.find((m) => m.id === messageId);
    if (!conversation || !message) return;
    const visible = message.content.slice(0, this.streamedLength(messageId) ?? message.content.length);
    this.clearStream(messageId);
    this.command(() => this.app.stopGeneration(this.session(), conversationId, messageId, visible));
  }

  confirmProposal(conversationId: string, proposalId: string): void {
    this.command(() => {
      const { run } = this.app.confirmProposal(this.session(), conversationId, proposalId);
      this.toast('success', 'Run launched', `${run.workflowInstanceId}: the harness sequences the steps.`);
    });
  }

  cancelProposal(conversationId: string, proposalId: string): void {
    this.command(() => this.app.cancelProposal(this.session(), conversationId, proposalId));
  }

  changeProposal(conversationId: string, proposalId: string, inputs: Record<string, string>): void {
    this.command(() => this.app.changeProposal(this.session(), conversationId, proposalId, inputs));
  }

  decideGate(
    runId: string,
    gateId: string,
    decision: GateDecision,
    comment: string | null,
    reviewerSeconds: number,
  ): void {
    this.command(() =>
      this.reportEvents(this.app.decideGate(this.session(), runId, gateId, decision, comment, reviewerSeconds).events),
    );
  }

  cancelRun(runId: string): void {
    this.command(() => this.reportEvents(this.app.cancelRun(this.session(), runId).events));
  }

  invite(conversationId: string, actor: ActorRef): void {
    this.command(() => this.app.invite(this.session(), conversationId, actor));
  }

  archiveConversation(conversationId: string): void {
    this.command(() => this.app.archiveConversation(this.session(), conversationId));
  }

  restoreConversation(conversationId: string): void {
    this.command(() => this.app.restoreConversation(this.session(), conversationId));
  }

  renameConversation(conversationId: string, title: string): void {
    this.command(() => this.app.renameConversation(this.session(), conversationId, title));
  }

  openChildThread(conversationId: string, messageId: string, purpose: string): void {
    this.command(() => this.app.openChildThread(this.session(), conversationId, messageId, purpose));
  }

  cancelChildThread(conversationId: string, threadId: string): void {
    this.command(() => this.app.cancelChildThread(this.session(), conversationId, threadId));
  }

  acknowledgeAiNotice(): void {
    this.command(() => this.app.acknowledgeAiNotice(this.session().userId));
  }

  markNotificationRead(id: string): void {
    this.command(() => this.app.markNotificationRead(this.session(), id));
  }

  markAllNotificationsRead(): void {
    this.command(() => this.app.markAllNotificationsRead(this.session()));
  }

  switchUser(userId: string): void {
    const member = this.tenant().members.find((m) => m.userId === userId);
    if (!member) return;
    this.session.set({ userId, tenantId: this.session().tenantId });
    this.bump();
  }

  toggleRunsPaused(): void {
    this.runsPaused.update((v) => !v);
  }

  /** Advances active runs one unit (also used by the scheduler). */
  step(): void {
    const events = this.app.advanceRuns(this.workspaceId());
    if (events.length > 0) {
      this.reportEvents(events);
      this.bump();
    }
  }

  // -------------------------------------------------------------- internals

  private command<T>(fn: () => T): T | null {
    try {
      const result = fn();
      this.bump();
      return result;
    } catch (error) {
      const text = error instanceof DomainError ? error.message : 'Something went wrong. Nothing was changed.';
      this.toast('error', 'Refused', text);
      this.bump();
      return null;
    }
  }

  private bump(): void {
    this.version.update((v) => v + 1);
  }

  private toast(severity: 'info' | 'success' | 'warn' | 'error', summary: string, detail: string): void {
    this.messages.add({ severity, summary, detail, life: severity === 'error' ? 7000 : severity === 'success' ? 2500 : 4000 });
  }

  private reportEvents(events: readonly RuntimeEvent[]): void {
    for (const event of events) {
      switch (event.kind) {
        case 'gate-raised':
          this.toast(
            'warn',
            `★ ${event.gate.label}`,
            'A validation conversation was opened; the run waits for a decision.',
          );
          break;
        case 'commit-gate-reverted':
          this.toast(
            'info',
            'Commit gate',
            `Reverted a write of ${event.stepSlug}: ${event.reason}. The agent retries.`,
          );
          break;
        case 'budget-alert':
          this.toast(
            'warn',
            'Budget alert',
            `${event.usedTokens.toLocaleString()} of ${event.limitTokens.toLocaleString()} tokens used.`,
          );
          break;
        case 'run-ended':
          this.toast(
            event.status === 'succeeded' ? 'success' : event.status === 'failed' ? 'error' : 'info',
            `Run ${event.status}`,
            '',
          );
          break;
        default:
          break;
      }
    }
  }

  private startScheduler(): void {
    if (this.scheduler || typeof setInterval !== 'function') return;
    this.scheduler = setInterval(() => {
      if (this.runsPaused()) return;
      if (this.activeRuns().some((r) => r.status === 'queued' || r.status === 'running')) this.step();
    }, TICK_MS);
  }

  private streamNewAgentMessages(conversation: Conversation, knownIds: readonly string[]): void {
    const known = new Set(knownIds);
    const fresh = conversation.messages.filter(
      (m) => !known.has(m.id) && m.author.kind === 'agent' && m.streaming === 'streaming',
    );
    let delay = 0;
    for (const message of fresh) {
      const id = message.id;
      const total = message.content.length;
      this.streamProgress.update((p) => ({ ...p, [id]: 0 }));
      const start = delay;
      delay += Math.min(2400, (total / STREAM_CHARS_PER_FRAME) * STREAM_FRAME_MS) + 250;
      setTimeout(() => {
        const timer = setInterval(() => {
          const current = this.streamProgress()[id];
          if (current === undefined) {
            clearInterval(timer);
            return;
          }
          const next = Math.min(total, current + STREAM_CHARS_PER_FRAME);
          if (next >= total) {
            this.clearStream(id);
            this.markDone(conversation.id, id);
          } else {
            this.streamProgress.update((p) => ({ ...p, [id]: next }));
          }
        }, STREAM_FRAME_MS);
        this.streamTimers.set(id, timer);
      }, start);
    }
  }

  private clearStream(messageId: string): void {
    const timer = this.streamTimers.get(messageId);
    if (timer) clearInterval(timer);
    this.streamTimers.delete(messageId);
    this.streamProgress.update((p) => {
      const copy = { ...p };
      delete copy[messageId];
      return copy;
    });
  }

  private markDone(conversationId: string, messageId: string): void {
    try {
      this.app.completeStreaming(this.session(), conversationId, messageId);
    } catch {
      // The conversation may have been closed or the user switched: nothing to mark.
    } finally {
      this.bump();
    }
  }
}
