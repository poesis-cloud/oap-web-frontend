import { describe, expect, it } from 'vitest';
import { mainThread } from '../core/domain/conversation';
import { costPerAcceptedArtifact, pendingGate, runTokens, type Run } from '../core/domain/run';
import { AccessDeniedError, DomainError } from '../core/domain/types';
import { isValidJournalEntry } from '../core/saf/contracts';
import { parseArtifact } from '../core/saf/frontmatter';
import { createMockWorld, DEMO_WORKSPACE_ID, OTHER_WORKSPACE_ID, type MockWorld } from './mock-world';

const INTENT = 'Design a secure REST API for customer subscriptions.';

function fixedClock(): () => number {
  let t = Date.UTC(2026, 10, 8, 9, 0, 0);
  return () => (t += 1000);
}

function startWithProposal(world: MockWorld) {
  const conversation = world.app.startConversation(world.session, DEMO_WORKSPACE_ID, 'Subscriptions API', INTENT);
  const proposal = conversation.proposals.find((p) => p.status === 'proposed');
  expect(proposal, 'the orchestrator proposes a launch').toBeDefined();
  return { conversation, proposal: proposal! };
}

function advanceUntil(world: MockWorld, predicate: (run: Run) => boolean, runId: string, max = 60): Run {
  for (let i = 0; i < max; i += 1) {
    const run = world.app.run(world.session, runId);
    if (predicate(run)) return run;
    world.app.advanceRuns(DEMO_WORKSPACE_ID);
  }
  throw new Error('run did not reach the expected state');
}

describe('vertical slice: workspace → conversation → launch → run → gate → history', () => {
  it('dispatches the intent to the orchestrator, which proposes a launch; no run starts before a human confirms (F1-AC3)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    expect(proposal.workflowSlug).toBe('architectural-runway-extension');
    expect(proposal.proposedBy).toEqual({ kind: 'agent', slug: 'release-train-engineer' });
    expect(conversation.participants.map((p) => (p.actor.kind === 'agent' ? p.actor.slug : p.actor.userId))).toEqual(
      expect.arrayContaining(['alex-moreau', 'copilot', 'release-train-engineer']),
    );
    expect(world.app.runs(world.session, DEMO_WORKSPACE_ID)).toHaveLength(0);
    const agentMessages = conversation.messages.filter((m) => m.author.kind === 'agent');
    expect(agentMessages.every((m) => m.provenance !== null)).toBe(true);
    expect(agentMessages[0].provenance?.hostingClass).toBe('demo-scripted');
  });

  it('a new proposal supersedes the pending one; changing creates a new proposal (F17-AC2)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const changed = world.app.changeProposal(world.session, conversation.id, proposal.id, {
      intent: 'Design it with mTLS',
    });
    const statuses = changed.proposals.map((p) => p.status);
    expect(statuses).toEqual(['superseded', 'proposed']);
    const again = world.app.postMessage(
      world.session,
      conversation.id,
      mainThread(conversation).id,
      '/architectural-runway-extension again',
    );
    expect(again.proposals.filter((p) => p.status === 'proposed')).toHaveLength(1);
    expect(again.proposals.filter((p) => p.status === 'superseded')).toHaveLength(2);
  });

  it('runs the workflow on the harness lifecycle: resolution, commit gate, journal, gate, rework, acceptance', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const headBeforeLaunch = world.repository.head(DEMO_WORKSPACE_ID);
    const { run } = world.app.confirmProposal(world.session, conversation.id, proposal.id);
    expect(run.status).toBe('queued');
    // The run executes the organization at the commit where it starts (F4-R11).
    expect(run.organizationCommit).toBe(headBeforeLaunch);

    const waiting = advanceUntil(world, (r) => r.status === 'waiting-for-gate', run.id);
    expect(waiting.steps.every((s) => s.status === 'delivered')).toBe(true);
    const gate = pendingGate(waiting)!;
    expect(gate.label).toBe('Architecture Gate');
    expect(gate.holderRole).toBe('central-supervisor');
    expect(gate.artifactPath).toMatch(/\.adr\.md$/);

    // The commit gate reverted the first ADR write and journaled why (F4-AC8).
    const adrStep = waiting.steps.find((s) => s.stepSlug === 'author-adr')!;
    expect(adrStep.verdicts.some((v) => v.fn === 'check-step-artifact' && v.status === 'reverted')).toBe(true);
    const adr = world.app.artifact(world.session, DEMO_WORKSPACE_ID, gate.artifactPath)!;
    expect(adr.versions).toHaveLength(1);
    expect(parseArtifact(adr.head.content).frontmatter['status']).toBe('proposed');

    // Every journal entry honours the log-entry contract; every step has model and verdicts (F4-AC2, F4-AC7).
    const journal = world.app.journal(world.session, DEMO_WORKSPACE_ID);
    expect(journal.length).toBeGreaterThan(30);
    expect(journal.every((e) => isValidJournalEntry(e))).toBe(true);
    for (const step of waiting.steps) {
      expect(step.model?.profile).toBeTruthy();
      const resolved = journal.find(
        (e) =>
          e.report.context.function === 'resolve-step-model' &&
          journal.indexOf(e) < journal.findIndex((x) => e !== x && x.report.context.sessionId === step.sessionId),
      );
      expect(resolved).toBeDefined();
      const sessionLog = world.repository.journalForSession(DEMO_WORKSPACE_ID, step.sessionId);
      expect(sessionLog[0].report.context.function).toBe('start-session');
      expect(sessionLog[sessionLog.length - 1].report.context.function).toBe('end-session');
      expect(sessionLog[0].report.context.parentSessionId).toBe(waiting.orchestratorSessionId);
    }

    // The gate prompt reached the conversation (S7-AC2) and the run does not progress (F4-AC3).
    const withGate = world.app.conversation(world.session, conversation.id);
    expect(withGate.messages.some((m) => m.kind === 'gate' && m.refs.gateId === gate.id)).toBe(true);
    world.app.advanceRuns(DEMO_WORKSPACE_ID);
    expect(world.app.run(world.session, run.id).status).toBe('waiting-for-gate');

    // A member without the holder role cannot decide (F4-R3); a rejection needs a comment.
    expect(() => world.app.decideGate(world.memberSession, run.id, gate.id, 'approved', null, 10)).toThrow(
      AccessDeniedError,
    );
    expect(() => world.app.decideGate(world.session, run.id, gate.id, 'rejected', '', 10)).toThrow(DomainError);

    // Rejection with a comment reroutes to rework; the comment reaches the next ADR revision (S7-AC3).
    const rejected = world.app.decideGate(
      world.session,
      run.id,
      gate.id,
      'rejected',
      'Partners need mTLS, not only bearer tokens.',
      95,
    );
    expect(rejected.run.status).toBe('running');
    expect(rejected.run.steps.find((s) => s.stepSlug === 'author-adr')?.status).toBe('pending');
    expect(rejected.run.steps.find((s) => s.stepSlug === 'author-nfrs')?.status).toBe('delivered');
    const reworked = advanceUntil(world, (r) => r.status === 'waiting-for-gate', run.id);
    const gate2 = pendingGate(reworked)!;
    expect(gate2.id).not.toBe(gate.id);
    const adr2 = world.app.artifact(world.session, DEMO_WORKSPACE_ID, gate2.artifactPath)!;
    expect(adr2.versions).toHaveLength(2);
    expect(adr2.head.content).toContain('mTLS');
    expect(adr2.head.content).toContain('Revision 2');

    // Approval accepts the artifacts: ADR accepted, Feature leaves arch-pending, run succeeded (F5-AC1, R14).
    const approved = world.app.decideGate(world.session, run.id, gate2.id, 'approved', null, 120);
    expect(approved.run.status).toBe('succeeded');
    const adrFinal = world.app.artifact(world.session, DEMO_WORKSPACE_ID, gate2.artifactPath)!;
    expect(parseArtifact(adrFinal.head.content).frontmatter['status']).toBe('accepted');
    const items = world.app.workItems(world.session, DEMO_WORKSPACE_ID);
    const feature = items.find((i) => i.itemId === 'F-12')!;
    expect(feature.status).toBe('ready');
    expect(feature.runIds).toContain(run.id);
    const adrItem = items.find((i) => i.type === 'adr')!;
    expect(adrItem.status).toBe('accepted');

    // Cost per accepted artifact is computable from the run alone and matches usage attribution (F4-AC9).
    const finalRun = world.app.run(world.session, run.id);
    expect(costPerAcceptedArtifact(finalRun)).toBeGreaterThan(0);
    const usage = world.app.usageForRun(world.session, run.id);
    const attributed = usage.reduce((sum, u) => sum + u.tokensIn + u.tokensOut, 0);
    expect(attributed).toBe(runTokens(finalRun).total);
    expect(usage.every((u) => u.tenantId === 'acme-it' && u.runId === run.id)).toBe(true);

    // History: every commit of the run names its session and run (F14-AC3); runs are rebuilt from the workspace (F14-AC4).
    const commits = world.app.commits(world.session, DEMO_WORKSPACE_ID).filter((c) => c.runId === run.id);
    expect(commits.length).toBeGreaterThan(10);
    expect(commits.every((c) => c.sessionId !== null)).toBe(true);
    const rebuilt = world.repository.runs(DEMO_WORKSPACE_ID).find((r) => r.id === run.id)!;
    expect(rebuilt).toEqual(finalRun);
  });

  it('a raised ★ gate is the orchestrator\'s message in the launching conversation; holders are invited there and notified (S22, F4-R3)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const { run } = world.app.confirmProposal(world.session, conversation.id, proposal.id);
    const waiting = advanceUntil(world, (r) => r.status === 'waiting-for-gate', run.id);
    const gate = pendingGate(waiting)!;

    // Supervision: the gate waits for Alex, in the conversation that launched the run.
    const [entry] = world.app.gatesWaitingFor(world.session, DEMO_WORKSPACE_ID);
    expect(entry.gate.id).toBe(gate.id);
    expect(entry.conversationId).toBe(conversation.id);
    expect(world.app.gateConversationFor(world.session, gate.id)?.id).toBe(conversation.id);
    const launching = world.app.conversation(world.session, conversation.id);
    expect(launching.kind).toBe('work');
    // The gate is the orchestrator's message, awaiting a decision.
    const gateMessage = launching.messages.find((m) => m.kind === 'gate' && m.refs.gateId === gate.id)!;
    expect(gateMessage.author).toEqual({ kind: 'agent', slug: 'release-train-engineer' });
    expect(gateMessage.content).toContain(gate.label);
    // Holders of the role (Alex, Priya) take part; the orchestrator is there since the launch; Sam is not invited.
    const humans = launching.participants
      .filter((p) => p.status === 'joined' && p.actor.kind === 'human')
      .map((p) => (p.actor as { userId: string }).userId)
      .sort();
    expect(humans).toEqual(['alex-moreau', 'priya-nair']);
    expect(launching.participants.some((p) => p.actor.kind === 'agent' && p.actor.slug === 'release-train-engineer')).toBe(true);
    expect(() => world.app.conversation(world.memberSession, launching.id)).toThrow(AccessDeniedError);

    // Notifications: Alex and Priya are invited to that conversation; Sam is not.
    const alex = world.app.notifications(world.session);
    expect(
      alex.some((n) => n.kind === 'gate-invitation' && n.refs.gateId === gate.id && n.refs.conversationId === conversation.id),
    ).toBe(true);
    expect(world.app.notifications(world.adminSession).some((n) => n.kind === 'gate-invitation')).toBe(true);
    expect(world.app.notifications(world.memberSession)).toHaveLength(0);
    expect(world.app.unreadNotifications(world.session)).toBeGreaterThan(0);

    // During the gate, a message without address goes to the orchestrator, which answers about the gate;
    // an addressed agent of the run still answers in scope.
    const discussed = world.app.postMessage(world.adminSession, launching.id, mainThread(launching).id, 'I would like mTLS for partner calls.');
    const orchestratorAnswer = discussed.messages.filter((m) => m.author.kind === 'agent' && m.kind === 'text').at(-1)!;
    expect(orchestratorAnswer.author).toEqual({ kind: 'agent', slug: 'release-train-engineer' });
    expect(orchestratorAnswer.content).toContain(gate.label);
    const asked = world.app.postMessage(world.session, launching.id, mainThread(launching).id, '@security-expert what about token replay?');
    expect(asked.messages.some((m) => m.author.kind === 'agent' && m.author.slug === 'security-expert')).toBe(true);

    // Deciding closes the workflow, not the conversation; the launcher is not re-notified for their own decision.
    world.app.markAllNotificationsRead(world.session);
    expect(world.app.unreadNotifications(world.session)).toBe(0);
    const approved = world.app.decideGate(world.adminSession, run.id, gate.id, 'approved', null, 30);
    expect(approved.run.status).toBe('succeeded');
    const after = world.app.conversation(world.session, conversation.id);
    expect(after.status).toBe('open');
    expect(after.messages.some((m) => m.kind === 'system' && m.content.includes('Gate approved'))).toBe(true);
    const unread = world.app.notifications(world.session).filter((n) => n.readAt === null);
    expect(unread.map((n) => n.kind).sort()).toEqual(['gate-decided', 'run-succeeded']);
    world.app.markNotificationRead(world.session, unread[0].id);
    expect(world.app.unreadNotifications(world.session)).toBe(1);
    expect(() => world.app.markNotificationRead(world.memberSession, unread[1].id)).toThrow(AccessDeniedError);
  });

  it('every worker session of a run is a conversation where the agent exposes its work (Clément, 2026-11-09)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const { run } = world.app.confirmProposal(world.session, conversation.id, proposal.id);
    const waiting = advanceUntil(world, (r) => r.status === 'waiting-for-gate', run.id);

    for (const step of waiting.steps.filter((s) => s.status === 'delivered')) {
      const session = world.app.sessionConversation(world.session, run.id, step.stepSlug)!;
      expect(session.kind).toBe('session');
      expect(session.sessionRef).toEqual({ runId: run.id, sessionId: step.sessionId, stepSlug: step.stepSlug, agent: step.actor });
      expect(session.subject).toBe(step.artifactPath);
      // The agent opened the session and reported its delivery; the launcher takes part.
      expect(session.messages[0].author).toEqual({ kind: 'agent', slug: step.actor });
      expect(session.messages.at(-1)!.content).toContain('Delivered');
      expect(session.participants.some((p) => p.actor.kind === 'human' && p.actor.userId === world.session.userId)).toBe(true);
      // The launching conversation points to the session.
      const launching = world.app.conversation(world.session, conversation.id);
      expect(launching.messages.some((m) => m.refs.sessionConversationId === session.id)).toBe(true);
      // Not visible to a member outside the tenant conversation's participants.
      expect(() => world.app.conversation(world.memberSession, session.id)).toThrow(AccessDeniedError);
    }
    // A reverted write is told in the session of the step that was reverted.
    const reverted = waiting.steps.find((s) => s.verdicts.some((v) => v.status === 'reverted'));
    if (reverted) {
      const session = world.app.sessionConversation(world.session, run.id, reverted.stepSlug)!;
      expect(session.messages.some((m) => m.content.includes('rejected my write'))).toBe(true);
    }
    // A human asks the worker in its session; the worker answers within its scope.
    const adr = waiting.steps.find((s) => s.stepSlug === 'author-adr')!;
    const session = world.app.sessionConversation(world.session, run.id, adr.stepSlug)!;
    const answered = world.app.postMessage(world.session, session.id, mainThread(session).id, 'Why did you choose OAuth here?');
    expect(answered.messages.at(-1)!.author).toEqual({ kind: 'agent', slug: 'system-architect' });
  });

  it('approving with a reservation records a pain point with its evidence (F1-R11)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const { run } = world.app.confirmProposal(world.session, conversation.id, proposal.id);
    const waiting = advanceUntil(world, (r) => r.status === 'waiting-for-gate', run.id);
    const result = world.app.decideGate(
      world.session,
      run.id,
      pendingGate(waiting)!.id,
      'approved-with-reservation',
      'Token lifetime should be 5 minutes.',
      60,
    );
    expect(result.run.status).toBe('succeeded');
    const pain = world.app.workItems(world.session, DEMO_WORKSPACE_ID).find((i) => i.type === 'pain-point');
    expect(pain?.status).toBe('open');
  });

  it('cancelling keeps produced artifacts marked partial (F4-AC6)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const { run } = world.app.confirmProposal(world.session, conversation.id, proposal.id);
    advanceUntil(world, (r) => r.steps.filter((s) => s.status === 'delivered').length >= 2, run.id);
    const cancelled = world.app.cancelRun(world.session, run.id);
    expect(cancelled.run.status).toBe('cancelled');
    expect(cancelled.run.partialArtifacts.length).toBeGreaterThanOrEqual(2);
    expect(world.app.artifact(world.session, DEMO_WORKSPACE_ID, cancelled.run.partialArtifacts[0])).not.toBeNull();
    expect(() => world.app.advanceRuns(DEMO_WORKSPACE_ID)).not.toThrow();
  });

  it('stops cleanly with Failed (budget) when the tenant budget is exceeded (F4-AC4)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation, proposal } = startWithProposal(world);
    const tinyBudget = { ...world.tenant, budget: { limitTokens: 20_000, alertAtRatio: 0.8 } };
    const runtimeRun = world.runtime.launch({
      workspace: world.workspace,
      organization: world.organization,
      proposal,
      conversationId: conversation.id,
      launchedBy: { kind: 'human', userId: world.session.userId },
      budgetLimitTokens: tinyBudget.budget.limitTokens,
    });
    let run = runtimeRun;
    for (let i = 0; i < 40 && run.status !== 'failed'; i += 1) run = world.runtime.advance(run.id).run;
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('budget');
  });

  it('isolates tenants: a member of another Organization cannot list, read or act (F17-AC7, F14-AC6)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation } = startWithProposal(world);
    expect(() => world.app.workspace(world.otherSession, DEMO_WORKSPACE_ID)).toThrow(AccessDeniedError);
    expect(() => world.app.conversations(world.otherSession, DEMO_WORKSPACE_ID)).toThrow(AccessDeniedError);
    expect(() => world.app.conversation(world.otherSession, conversation.id)).toThrow(AccessDeniedError);
    expect(() => world.app.artifacts(world.otherSession, DEMO_WORKSPACE_ID)).toThrow(AccessDeniedError);
    expect(() => world.app.journal(world.otherSession, DEMO_WORKSPACE_ID)).toThrow(AccessDeniedError);
    expect(world.app.workspaces(world.otherSession).map((w) => w.id)).toEqual([OTHER_WORKSPACE_ID]);
    // A conversation is visible only to its participants (F1-R4): Sam is a member but not a participant.
    expect(() => world.app.conversation(world.memberSession, conversation.id)).toThrow(AccessDeniedError);
    const invited = world.app.invite(world.session, conversation.id, { kind: 'human', userId: 'sam-ortega' });
    expect(invited.participants.some((p) => p.actor.kind === 'human' && p.actor.userId === 'sam-ortega')).toBe(true);
    expect(world.app.conversation(world.memberSession, conversation.id).id).toBe(conversation.id);
    expect(() => world.app.invite(world.session, conversation.id, { kind: 'human', userId: 'casey-lin' })).toThrow(
      DomainError,
    );
    expect(() => world.app.invite(world.session, conversation.id, { kind: 'agent', slug: 'ghost' })).toThrow(
      DomainError,
    );
  });

  it('refuses free chat: an out-of-scope request gets the closest workflows (F1-AC7)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const conversation = world.app.startConversation(
      world.session,
      DEMO_WORKSPACE_ID,
      'Small talk',
      'What is the weather like in Lyon today?',
    );
    const answer = conversation.messages.filter((m) => m.author.kind === 'agent').at(-1)!;
    expect(answer.content).toContain('no free chat');
    expect(conversation.proposals).toHaveLength(0);
  });

  it('lets Copilot consult two specialists in parallel child threads and resume (F1-AC9)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const conversation = world.app.startConversation(
      world.session,
      DEMO_WORKSPACE_ID,
      'Consult',
      'Please consult both the architect and security on the subscriptions API.',
    );
    const children = conversation.threads.filter((t) => t.parentThreadId !== null);
    expect(children).toHaveLength(2);
    expect(children.every((t) => t.status === 'returned')).toBe(true);
    expect(mainThread(conversation).status).toBe('open');
    expect(conversation.messages.filter((m) => m.refs.childThreadId).length).toBe(2);
  });

  it('archived conversations accept no message; messages are never modified (F17-AC5, F17-AC8)', () => {
    const world = createMockWorld({ now: fixedClock() });
    const { conversation } = startWithProposal(world);
    const archived = world.app.archiveConversation(world.session, conversation.id);
    expect(() => world.app.postMessage(world.session, archived.id, mainThread(archived).id, 'hello')).toThrow(
      DomainError,
    );
    const restored = world.app.restoreConversation(world.session, conversation.id);
    expect(restored.status).toBe('open');
    const before = restored.messages.map((m) => m.content);
    const after = world.app.postMessage(
      world.session,
      restored.id,
      mainThread(restored).id,
      '@developer is it feasible?',
    );
    expect(after.messages.slice(0, before.length).map((m) => m.content)).toEqual(before);
  });
});
