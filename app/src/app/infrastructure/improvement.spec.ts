import { describe, expect, it } from 'vitest';
import { mainThread } from '../core/domain/conversation';
import { ADR_INSTRUCTION, PREFLIGHT_MARKER, changePath, readChange } from '../core/domain/improvement';
import { pendingGate, type Run } from '../core/domain/run';
import { Actor } from '../core/domain/types';
import { parseArtifact } from '../core/saf/frontmatter';
import { createMockWorld, DEMO_WORKSPACE_ID as WS, type MockWorld } from './mock-world';

const original = '# Author ADR\n\nWrite the ADR using the organization schema.\n';
function world() {
  let t = Date.UTC(2026, 10, 9, 10);
  return createMockWorld({ now: () => t += 1000, sources: { root: 'test', package: 'saf-agentic-organization', version: 'test', folders: ['instructions'], files: { [ADR_INSTRUCTION.slice('organization/'.length)]: original } } });
}
function launch(w: MockWorld, text: string, subject: string | null = null) {
  const c = w.app.startConversation(w.session, WS, 'Test concern', text, subject);
  const p = c.proposals.find(p => p.status === 'proposed');
  expect(p, text).toBeDefined();
  return w.app.confirmProposal(w.session, c.id, p!.id).run;
}
function until(w: MockWorld, id: string, status: Run['status']) {
  for (let n = 0; n < 100; n++) {
    const run = w.app.run(w.session, id);
    if (run.status === status) return run;
    if (run.status === 'failed') throw new Error(run.failure?.message);
    w.app.advanceRuns(WS);
  }
  throw new Error(`Run ${id} never reached ${status}`);
}
function approve(w: MockWorld, id: string) {
  const r = until(w, id, 'waiting-for-gate');
  return w.app.decideGate(w.session, id, pendingGate(r)!.id, 'approved', null, 30).run;
}
function capture(w: MockWorld) {
  const source = launch(w, 'Design the subscriptions API.');
  approve(w, source.id);
  const run = launch(w, `/improvement-backlog Record ${source.id} rejection`);
  until(w, run.id, 'succeeded');
  const pain = w.app.workItems(w.session, WS).find(i => i.type === 'pain-point')!;
  return { source, pain };
}

describe('F16 frontend learning loop', () => {
  it('captures a single schema-complete pain point with the rejected session and a retrospective thread', () => {
    const w = world();
    const { source, pain } = capture(w);
    const metadata = parseArtifact(w.repository.read(WS, pain.path)!).frontmatter;
    expect(metadata).toMatchObject({ status: 'open', origin: 'workflow', layer: 'program', sourceRun: source.id, sourceStep: 'author-adr', owner: 'release-train-engineer', targetArtifact: ADR_INSTRUCTION });
    for (const key of ['title', 'symptom', 'impact', 'created']) expect(metadata[key]).toBeTruthy();
    expect(w.repository.journalForSession(WS, String(metadata['sourceSession'])).some(e => e.report.outcome.status === 'reverted')).toBe(true);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
    const retrospective = w.app.startRetrospective(w.session, WS);
    const thread = retrospective.threads.find(t => t.parentThreadId)!;
    expect(retrospective.threads).toHaveLength(2);
    expect(retrospective.messages.find(m => m.id === thread.openingMessageId)?.refs.artifactPath).toBe(pain.path);
    const returned = w.app.returnChildThread(w.session, retrospective.id, thread.id, 'Propose a preflight check; observe three runs before resolution.');
    expect(returned.threads.find(t => t.id === thread.id)?.status).toBe('returned');
    expect(returned.messages.at(-1)?.threadId).toBe(mainThread(retrospective).id);
    expect(() => w.app.postMessage(w.session, returned.id, thread.id, 'late reply')).toThrow('ended');
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
  });

  it('applies only the reviewed bytes after the human gate and restores exactly through a separate rollback run', () => {
    const w = world();
    const { pain } = capture(w);
    const run = launch(w, '/organization-change Add the ADR status preflight.', pain.path);
    const waiting = until(w, run.id, 'waiting-for-gate');
    const change = readChange(w.repository.read(WS, changePath(run.id)))!;
    expect(change.before).toBe(original);
    expect(change.after).toContain(PREFLIGHT_MARKER);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
    expect(() => w.app.decideGate(w.memberSession, run.id, pendingGate(waiting)!.id, 'approved', null, 20)).toThrow();
    approve(w, run.id);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(change.after);
    expect(parseArtifact(w.repository.read(WS, pain.path)!).frontmatter['status']).toBe('triaged');
    const measured = launch(w, 'Design the subscriptions API.');
    const measuredFinal = approve(w, measured.id);
    expect(measuredFinal.steps.flatMap(s => s.verdicts).filter(v => v.status === 'reverted')).toHaveLength(0);
    const rollback = launch(w, '/organization-change rollback');
    until(w, rollback.id, 'waiting-for-gate');
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(change.after);
    approve(w, rollback.id);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
    expect(parseArtifact(w.repository.read(WS, pain.path)!).frontmatter['status']).toBe('open');
    const afterRollback = launch(w, 'Design the subscriptions API.');
    expect(until(w, afterRollback.id, 'waiting-for-gate').steps.flatMap(s => s.verdicts).some(v => v.status === 'reverted')).toBe(true);
    expect(w.repository.artifact(WS, ADR_INSTRUCTION)?.versions).toHaveLength(3);
  });

  it('keeps active runs pinned to the organization snapshot at launch', () => {
    const w = world(); const { pain } = capture(w);
    const change = launch(w, '/organization-change ADR preflight', pain.path);
    until(w, change.id, 'waiting-for-gate');
    const oldRun = launch(w, 'Design the subscriptions API.');
    approve(w, change.id);
    expect(until(w, oldRun.id, 'waiting-for-gate').steps.flatMap(s => s.verdicts).some(v => v.status === 'reverted')).toBe(true);
  });

  it('rejects a stale approval atomically and leaves cancellation available', () => {
    const w = world(); const { pain } = capture(w);
    const a = launch(w, '/organization-change ADR preflight A', pain.path);
    const b = launch(w, '/organization-change ADR preflight B', pain.path);
    until(w, a.id, 'waiting-for-gate'); until(w, b.id, 'waiting-for-gate');
    approve(w, a.id);
    const head = w.repository.head(WS);
    expect(() => approve(w, b.id)).toThrow('changed since');
    expect(w.repository.head(WS)).toBe(head);
    expect(pendingGate(w.app.run(w.session, b.id))).toBeDefined();
    w.app.cancelRun(w.session, b.id);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toContain(PREFLIGHT_MARKER);
  });

  it('rejection creates new step conversations, preserves the original transcript, and never applies the rejected diff', () => {
    const w = world(); const { pain } = capture(w);
    const run = launch(w, '/organization-change ADR preflight', pain.path);
    const waiting = until(w, run.id, 'waiting-for-gate');
    const old = w.app.sessionConversation(w.session, run.id, 'draft-change')!;
    w.app.decideGate(w.session, run.id, pendingGate(waiting)!.id, 'rejected', 'Show the bounded change and rollback evidence.', 40);
    until(w, run.id, 'waiting-for-gate');
    const fresh = w.app.sessionConversation(w.session, run.id, 'draft-change')!;
    expect(fresh.id).not.toBe(old.id);
    expect(w.app.conversation(w.session, old.id).messages).toEqual(old.messages);
    expect(fresh.messages.at(-1)?.content).toContain('Delivered');
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
    w.app.cancelRun(w.session, run.id);
    expect(w.repository.read(WS, ADR_INSTRUCTION)).toBe(original);
  });

  it('keeps capture idempotent and refuses changes without loaded sources or matching evidence', () => {
    const w = world(); const { source, pain } = capture(w);
    const second = launch(w, `/improvement-backlog Record ${source.id}`);
    until(w, second.id, 'succeeded');
    expect(w.app.workItems(w.session, WS).filter(i => i.type === 'pain-point')).toHaveLength(1);
    const empty = createMockWorld();
    const c = empty.app.startConversation(empty.session, WS, 'Rollback', '/organization-change rollback');
    expect(() => empty.app.confirmProposal(empty.session, c.id, c.proposals[0].id)).toThrow('not loaded');
    expect(w.repository.read(WS, pain.path)).toBeTruthy();
  });
});

describe('Conversation and workspace coherence', () => {
  it('uses the sandbox Feature and preserves the accepted subscriptions ADR', () => {
    const w = world(); const subscriptions = launch(w, 'Design the subscriptions API.');
    const accepted = approve(w, subscriptions.id);
    const path = accepted.gates[0].artifactPath;
    const before = w.repository.read(WS, path);
    const sandbox = launch(w, 'Design the partner sandbox API.');
    const other = until(w, sandbox.id, 'waiting-for-gate');
    expect(other.gates[0].artifactPath).toContain('/partner-sandbox/');
    expect(w.repository.read(WS, path)).toBe(before);
    expect(parseArtifact(w.repository.read(WS, other.gates[0].artifactPath)!).frontmatter['parentFeature']).toBe('F-15');
  });

  it('does not pretend to be a human addressee or redirect unrelated team work to architecture', () => {
    const w = world();
    const c = w.app.startConversation(w.session, WS, 'Team sync', '@scrum-master plan the next iteration');
    expect(c.proposals).toHaveLength(0);
    expect(c.messages.at(-1)?.content).toContain('team work');
    w.app.invite(w.session, c.id, Actor.human('sam-ortega'));
    const direct = w.app.postMessage(w.session, c.id, mainThread(c).id, '@sam-ortega please review this');
    expect(direct.messages.at(-1)?.author).toEqual(Actor.human(w.session.userId));
  });

  it('blocks archived launches and child-thread returns without a conclusion', () => {
    const w = world(); const c = w.app.startConversation(w.session, WS, 'Architecture', 'Design the subscriptions API.');
    const child = w.app.openChildThread(w.session, c.id, c.messages[0].id, 'Discuss scope');
    const thread = child.threads[1];
    expect(() => w.app.returnChildThread(w.session, c.id, thread.id, ' ')).toThrow('conclusion');
    w.app.archiveConversation(w.session, c.id);
    expect(() => w.app.confirmProposal(w.session, c.id, c.proposals[0].id)).toThrow('Restore');
    expect(() => w.app.returnChildThread(w.session, c.id, thread.id, 'done')).toThrow('Restore');
  });

  it('creates an isolated empty workspace from the offered package and validates its name', () => {
    const w = world();
    const created = w.app.createWorkspace(w.session, 'Partner Experience', w.organization.id);
    expect(created.status).toBe('active');
    expect(created.nominalImportCommit).toBeTruthy();
    expect(w.repository.read(created.id, ADR_INSTRUCTION)).toBe(original);
    expect(w.app.workItems(w.session, created.id)).toHaveLength(0);
    expect(w.app.conversations(w.session, created.id)).toHaveLength(0);
    expect(() => w.app.workspace(w.otherSession, created.id)).toThrow();
    expect(() => w.app.createWorkspace(w.session, 'partner experience', w.organization.id)).toThrow('already');
    expect(() => w.app.createWorkspace(w.session, ' ', w.organization.id)).toThrow();
    expect(() => w.app.createWorkspace(w.session, 'Other', 'unknown')).toThrow();
    expect(w.app.workItems(w.session, WS).length).toBeGreaterThan(0);
  });
});
