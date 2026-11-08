import type { WorkItem } from '../domain/artifact';
import {
  acceptedArtifacts,
  humanWaitMs,
  rejectedGates,
  runDurationMs,
  stepDurationMs,
  type Run,
} from '../domain/run';
import type { IsoDateTime, RunId } from '../domain/types';
import { usageCost, type ModelPrice, type UsageRecord } from '../ports';
import { dirname } from './board';

/**
 * End-to-end analysis of the work (Clément, 2026-11-08): every run shows what it cost in
 * euros and how long it took; the Supervisor analyses a **subject** (a work item such as a
 * Feature) across all the workflows and runs that touched it, with the time spent working,
 * the time spent waiting for humans at ★ gates, the cost by agent and by model. Pure
 * functions over the read model; nothing here writes.
 */

export type PriceLookup = (model: string) => ModelPrice | null;

export interface RunMetrics {
  readonly run: Run;
  /** Cost in euros of every usage record the gateway attributed to the run; null when unpriced. */
  readonly cost: number | null;
  readonly tokens: number;
  readonly durationMs: number;
  readonly humanWaitMs: number;
  readonly workingMs: number;
  readonly acceptedArtifacts: number;
  readonly rejectedGates: number;
  /** Accepted at its gate without a rework: null while the run has not ended. */
  readonly firstPass: boolean | null;
}

export interface StepMetrics {
  readonly stepSlug: string;
  readonly actor: string;
  readonly model: string | null;
  readonly tokens: number;
  readonly cost: number | null;
  readonly durationMs: number;
}

export interface Share {
  readonly key: string;
  readonly cost: number;
  readonly tokens: number;
  readonly count: number;
}

export interface SubjectAnalysis {
  /** Folder of the work item (the subject), or '' for runs without a work item. */
  readonly key: string;
  readonly item: WorkItem | null;
  readonly title: string;
  readonly runs: readonly RunMetrics[];
  readonly workflows: readonly string[];
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  readonly totals: {
    readonly cost: number;
    readonly tokens: number;
    readonly elapsedMs: number;
    readonly workingMs: number;
    readonly humanWaitMs: number;
    readonly acceptedArtifacts: number;
    readonly rejectedGates: number;
  };
  readonly byAgent: readonly Share[];
  readonly byModel: readonly Share[];
  readonly byWorkflow: readonly Share[];
}

export interface WorkflowSummary {
  readonly workflowSlug: string;
  readonly runs: number;
  readonly succeeded: number;
  readonly cost: number;
  readonly acceptedArtifacts: number;
  /** Euros per accepted artifact (R14), null when nothing was accepted. */
  readonly costPerAcceptedArtifact: number | null;
  readonly averageDurationMs: number;
}

export function sumCost(records: readonly UsageRecord[], priceOf: PriceLookup): number | null {
  let total = 0;
  let priced = false;
  for (const record of records) {
    const cost = usageCost(record, priceOf(record.model));
    if (cost !== null) {
      total += cost;
      priced = true;
    }
  }
  return priced ? total : records.length === 0 ? 0 : null;
}

export function runMetrics(run: Run, usage: readonly UsageRecord[], priceOf: PriceLookup, now: IsoDateTime): RunMetrics {
  const durationMs = runDurationMs(run, now);
  const waiting = humanWaitMs(run, now);
  const ended = run.endedAt !== null;
  const rejected = rejectedGates(run);
  return {
    run,
    cost: sumCost(usage, priceOf),
    tokens: usage.reduce((sum, u) => sum + u.tokensIn + u.tokensOut, 0),
    durationMs,
    humanWaitMs: waiting,
    workingMs: Math.max(0, durationMs - waiting),
    acceptedArtifacts: new Set(acceptedArtifacts(run)).size,
    rejectedGates: rejected,
    firstPass: ended ? run.status === 'succeeded' && rejected === 0 : null,
  };
}

export function stepMetrics(run: Run, usage: readonly UsageRecord[], priceOf: PriceLookup, now: IsoDateTime): StepMetrics[] {
  return run.steps.map((step) => {
    const records = usage.filter((u) => u.stepSlug === step.stepSlug);
    return {
      stepSlug: step.stepSlug,
      actor: step.actor,
      model: step.model?.profile ?? null,
      tokens: step.tokens.input + step.tokens.output,
      cost: records.length ? sumCost(records, priceOf) : step.status === 'pending' ? null : 0,
      durationMs: stepDurationMs(step, now),
    };
  });
}

/** The work item a run worked on: the item whose folder holds the run's artifacts. */
export function subjectOf(run: Run, items: readonly WorkItem[]): WorkItem | null {
  const folders = new Set(run.steps.map((s) => (s.artifactPath ? dirname(s.artifactPath) : null)).filter(Boolean));
  return items.find((item) => item.runIds.includes(run.id) && folders.has(dirname(item.path))) ?? null;
}

export function analyzeSubjects(
  runs: readonly Run[],
  items: readonly WorkItem[],
  usageByRun: (runId: RunId) => readonly UsageRecord[],
  priceOf: PriceLookup,
  now: IsoDateTime,
): SubjectAnalysis[] {
  const groups = new Map<string, { item: WorkItem | null; metrics: RunMetrics[] }>();
  for (const run of [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const item = subjectOf(run, items);
    const key = item ? dirname(item.path) : '';
    const group = groups.get(key) ?? { item, metrics: [] };
    group.metrics.push(runMetrics(run, usageByRun(run.id), priceOf, now));
    groups.set(key, group);
  }
  const subjects: SubjectAnalysis[] = [];
  for (const [key, group] of groups) {
    const metrics = group.metrics;
    const from = metrics[0].run.startedAt;
    const to = metrics.reduce((latest, m) => {
      const end = m.run.endedAt ?? now;
      return end > latest ? end : latest;
    }, from);
    subjects.push({
      key,
      item: group.item,
      title: group.item ? `${group.item.itemId ? `${group.item.itemId} — ` : ''}${group.item.title}` : 'Without work item',
      runs: metrics,
      workflows: [...new Set(metrics.map((m) => m.run.workflowSlug))],
      from,
      to,
      totals: {
        cost: metrics.reduce((sum, m) => sum + (m.cost ?? 0), 0),
        tokens: metrics.reduce((sum, m) => sum + m.tokens, 0),
        elapsedMs: Math.max(0, new Date(to).getTime() - new Date(from).getTime()),
        workingMs: metrics.reduce((sum, m) => sum + m.workingMs, 0),
        humanWaitMs: metrics.reduce((sum, m) => sum + m.humanWaitMs, 0),
        acceptedArtifacts: metrics.reduce((sum, m) => sum + m.acceptedArtifacts, 0),
        rejectedGates: metrics.reduce((sum, m) => sum + m.rejectedGates, 0),
      },
      byAgent: shares(metrics, usageByRun, priceOf, (u, run) => run.steps.find((s) => s.stepSlug === u.stepSlug)?.actor ?? 'unknown'),
      byModel: shares(metrics, usageByRun, priceOf, (u) => u.model),
      byWorkflow: shares(metrics, usageByRun, priceOf, (_u, run) => run.workflowSlug),
    });
  }
  return subjects.sort((a, b) => b.to.localeCompare(a.to));
}

function shares(
  metrics: readonly RunMetrics[],
  usageByRun: (runId: RunId) => readonly UsageRecord[],
  priceOf: PriceLookup,
  keyOf: (record: UsageRecord, run: Run) => string,
): Share[] {
  const map = new Map<string, Share>();
  for (const m of metrics) {
    for (const record of usageByRun(m.run.id)) {
      const key = keyOf(record, m.run);
      const current = map.get(key) ?? { key, cost: 0, tokens: 0, count: 0 };
      map.set(key, {
        key,
        cost: current.cost + (usageCost(record, priceOf(record.model)) ?? 0),
        tokens: current.tokens + record.tokensIn + record.tokensOut,
        count: current.count + 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
}

export function summarizeWorkflows(metrics: readonly RunMetrics[]): WorkflowSummary[] {
  const map = new Map<string, RunMetrics[]>();
  for (const m of metrics) map.set(m.run.workflowSlug, [...(map.get(m.run.workflowSlug) ?? []), m]);
  return [...map.entries()].map(([workflowSlug, list]) => {
    const cost = list.reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const accepted = list.reduce((sum, m) => sum + m.acceptedArtifacts, 0);
    return {
      workflowSlug,
      runs: list.length,
      succeeded: list.filter((m) => m.run.status === 'succeeded').length,
      cost,
      acceptedArtifacts: accepted,
      costPerAcceptedArtifact: accepted > 0 ? cost / accepted : null,
      averageDurationMs: list.reduce((sum, m) => sum + m.durationMs, 0) / list.length,
    };
  });
}

/** Human-readable duration: 42 s, 3 min 10 s, 2 h 05. */
export function formatDuration(msValue: number): string {
  const s = Math.round(msValue / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

/** Euros with two decimals, or a dash when the gateway priced nothing. */
export function formatEuros(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export interface TimelineSegment {
  readonly from: IsoDateTime;
  readonly to: IsoDateTime;
  /** `work`: agents and harness at work; `wait`: waiting for humans at a ★ gate. */
  readonly kind: 'work' | 'wait';
}

/** The run's time split into work and gate-wait segments, in order, for timelines. */
export function runSegments(run: Run, now: IsoDateTime): TimelineSegment[] {
  const end = run.endedAt ?? now;
  const waits = [...run.gates]
    .map((g) => ({ from: g.raisedAt, to: g.decidedAt ?? end }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const segments: TimelineSegment[] = [];
  let cursor = run.startedAt;
  for (const wait of waits) {
    if (wait.from > cursor) segments.push({ from: cursor, to: wait.from, kind: 'work' });
    segments.push({ from: wait.from, to: wait.to, kind: 'wait' });
    cursor = wait.to > cursor ? wait.to : cursor;
  }
  if (end > cursor || segments.length === 0) segments.push({ from: cursor, to: end, kind: 'work' });
  return segments;
}

/** Position of a time span inside [from, to] as left/width percentages. */
export function spanPercent(from: IsoDateTime, to: IsoDateTime, rangeFrom: IsoDateTime, rangeTo: IsoDateTime) {
  const start = new Date(rangeFrom).getTime();
  const total = Math.max(1, new Date(rangeTo).getTime() - start);
  const left = ((new Date(from).getTime() - start) / total) * 100;
  const width = ((new Date(to).getTime() - new Date(from).getTime()) / total) * 100;
  return { left: Math.max(0, Math.min(100, left)), width: Math.max(0.5, Math.min(100, width)) };
}
