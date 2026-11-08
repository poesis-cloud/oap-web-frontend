import { describe, expect, it } from 'vitest';
import type { WorkItem } from '../domain/artifact';
import type { Run } from '../domain/run';
import type { ModelPrice, UsageRecord } from '../ports';
import { analyzeSubjects, formatDuration, formatEuros, runMetrics, summarizeWorkflows } from './analysis';

const NOW = '2026-11-08T12:10:00.000Z';
const price: ModelPrice = { model: 'm', currency: 'EUR', inputPerMTokens: 2, outputPerMTokens: 10 };
const priceOf = (model: string) => (model === 'm' ? price : null);

function run(partial: Partial<Run>): Run {
  return {
    id: 'run-1',
    workspaceId: 'ws',
    conversationId: 'conv-1',
    proposalId: 'p-1',
    workflowSlug: 'architectural-runway-extension',
    workflowInstanceId: 'are-1',
    orchestratorSessionId: 'sess-1',
    launchedBy: { kind: 'human', userId: 'alex' },
    organizationCommit: 'c0',
    status: 'succeeded',
    steps: [
      {
        stepSlug: 'author-adr',
        actor: 'system-architect',
        sessionId: 's1',
        attempt: 1,
        status: 'delivered',
        model: null,
        tokens: { input: 1000, output: 500 },
        artifactPath: 'art/platform/program-backlog/f12/f12.adr.md',
        commitSha: 'c1',
        verdicts: [],
        challengeRounds: 0,
        startedAt: '2026-11-08T12:00:00.000Z',
        endedAt: '2026-11-08T12:01:00.000Z',
      },
    ],
    gates: [
      {
        id: 'g1',
        runId: 'run-1',
        slug: 'architecture-gate',
        label: 'Architecture Gate',
        holderRole: 'central-supervisor',
        artifactPath: 'art/platform/program-backlog/f12/f12.adr.md',
        status: 'approved',
        raisedAt: '2026-11-08T12:01:00.000Z',
        decidedBy: { kind: 'human', userId: 'alex' },
        decidedAt: '2026-11-08T12:04:00.000Z',
        comment: null,
        reviewerSeconds: 180,
      },
    ],
    budget: { limitTokens: 100000 },
    startedAt: '2026-11-08T12:00:00.000Z',
    endedAt: '2026-11-08T12:05:00.000Z',
    failure: null,
    partialArtifacts: [],
    ...partial,
  };
}

const usage: UsageRecord[] = [
  {
    id: 'u1',
    tenantId: 't',
    workspaceId: 'ws',
    conversationId: 'conv-1',
    runId: 'run-1',
    stepSlug: 'author-adr',
    sessionId: 's1',
    userId: 'alex',
    model: 'm',
    source: 'mock-gateway',
    tokensIn: 1_000_000,
    tokensOut: 100_000,
    at: NOW,
  },
];

describe('run metrics', () => {
  it('prices the usage in euros and splits the time between work and human wait', () => {
    const m = runMetrics(run({}), usage, priceOf, NOW);
    expect(m.cost).toBeCloseTo(2 + 1, 6);
    expect(m.durationMs).toBe(5 * 60_000);
    expect(m.humanWaitMs).toBe(3 * 60_000);
    expect(m.workingMs).toBe(2 * 60_000);
    expect(m.acceptedArtifacts).toBe(1);
    expect(m.firstPass).toBe(true);
  });

  it('counts a run as still running up to now and leaves first pass undecided', () => {
    const m = runMetrics(run({ status: 'running', endedAt: null, gates: [] }), [], priceOf, NOW);
    expect(m.durationMs).toBe(10 * 60_000);
    expect(m.firstPass).toBeNull();
    expect(m.cost).toBe(0);
  });

  it('returns null cost when the gateway has no price for the model', () => {
    const m = runMetrics(run({}), [{ ...usage[0], model: 'unknown' }], priceOf, NOW);
    expect(m.cost).toBeNull();
  });
});

describe('subject analysis', () => {
  const item: WorkItem = {
    path: 'art/platform/program-backlog/f12/f12.feature.md',
    type: 'feature',
    itemId: 'F-12',
    title: 'Secure API',
    status: 'refined',
    owner: null,
    structurant: true,
    updatedAt: NOW,
    runIds: ['run-1', 'run-2'],
  };

  it('groups the runs of a work item across workflows with totals and shares', () => {
    const second = run({
      id: 'run-2',
      workflowSlug: 'feature-backlog-refinement',
      startedAt: '2026-11-08T12:06:00.000Z',
      endedAt: '2026-11-08T12:08:00.000Z',
      gates: [],
      steps: [{ ...run({}).steps[0], stepSlug: 'draft-business', actor: 'product-manager' }],
    });
    const byRun = (id: string) => (id === 'run-1' ? usage : [{ ...usage[0], id: 'u2', runId: 'run-2', stepSlug: 'draft-business' }]);
    const subjects = analyzeSubjects([second, run({})], [item], byRun, priceOf, NOW);
    expect(subjects).toHaveLength(1);
    const s = subjects[0];
    expect(s.title).toBe('F-12 — Secure API');
    expect(s.runs.map((m) => m.run.id)).toEqual(['run-1', 'run-2']);
    expect(s.workflows).toEqual(['architectural-runway-extension', 'feature-backlog-refinement']);
    expect(s.totals.cost).toBeCloseTo(6, 6);
    expect(s.totals.elapsedMs).toBe(8 * 60_000);
    expect(s.totals.humanWaitMs).toBe(3 * 60_000);
    expect(s.byAgent.map((x) => x.key).sort()).toEqual(['product-manager', 'system-architect']);
    expect(s.byWorkflow[0].count).toBe(1);
  });

  it('keeps runs without a work item in their own group', () => {
    const subjects = analyzeSubjects([run({ steps: [] })], [item], () => [], priceOf, NOW);
    expect(subjects[0].key).toBe('');
    expect(subjects[0].item).toBeNull();
  });

  it('summarizes workflows with the cost per accepted artifact in euros', () => {
    const summary = summarizeWorkflows([runMetrics(run({}), usage, priceOf, NOW)]);
    expect(summary[0].costPerAcceptedArtifact).toBeCloseTo(3, 6);
    expect(summary[0].succeeded).toBe(1);
  });
});

describe('formats', () => {
  it('formats durations and euros for humans', () => {
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(190_000)).toBe('3 min 10 s');
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 05');
    expect(formatEuros(null)).toBe('—');
    expect(formatEuros(3)).toMatch(/3,00/);
  });
});
