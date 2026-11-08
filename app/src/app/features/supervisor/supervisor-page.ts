import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tab, TabList, Tabs } from 'primeng/tabs';
import { Tag } from 'primeng/tag';
import {
  formatDuration,
  formatEuros,
  runSegments,
  spanPercent,
  type RunMetrics,
  type Share,
  type SubjectAnalysis,
} from '../../core/application/analysis';
import type { Notification } from '../../core/domain/notification';
import { isRunActive, type Gate, type Run } from '../../core/domain/run';
import { GateCard } from '../../shared/gate-card';
import { ActorBadge, AgoPipe, StatusBadge, TitlePipe, TokensPipe, fileName } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

type View = 'overview' | 'runs' | 'analysis';

export interface GateRow {
  readonly run: Run;
  readonly gate: Gate;
  readonly mine: boolean;
}

/**
 * Supervisor (F18-R4), the home. Clément, 2026-11-08: **decisions are gates, and gates are
 * conversations**; every run shows its AI cost in euros and the time it took; and the
 * Supervisor analyses the work end to end, by subject, across the workflows and runs that
 * touched it. Read-only: the only action is to open a gate conversation.
 */
@Component({
  selector: 'sai-supervisor-page',
  standalone: true,
  imports: [RouterLink, Button, Tabs, TabList, Tab, Tag, GateCard, StatusBadge, ActorBadge, TitlePipe, TokensPipe, AgoPipe],
  templateUrl: './supervisor-page.html',
})
export class SupervisorPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly view = input<View | string>('overview');
  readonly waiting = this.store.gatesWaitingForMe;
  readonly metrics = computed(() =>
    [...this.store.runMetrics()].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt)),
  );
  readonly active = computed(() => this.metrics().filter((m) => isRunActive(m.run)));
  readonly gates = computed((): GateRow[] => {
    const mine = new Set(this.waiting().map((w) => w.gate.id));
    return this.store
      .runs()
      .flatMap((run) => run.gates.map((gate) => ({ run, gate, mine: mine.has(gate.id) })))
      .sort((a, b) => {
        if ((a.gate.status === 'pending') !== (b.gate.status === 'pending')) return a.gate.status === 'pending' ? -1 : 1;
        return (b.gate.decidedAt ?? b.gate.raisedAt).localeCompare(a.gate.decidedAt ?? a.gate.raisedAt);
      });
  });
  readonly pendingGates = computed(() => this.gates().filter((g) => g.gate.status === 'pending').length);
  readonly totals = computed(() => {
    const list = this.store.runMetrics();
    return {
      cost: list.reduce((sum, m) => sum + (m.cost ?? 0), 0),
      workingMs: list.reduce((sum, m) => sum + m.workingMs, 0),
      humanWaitMs: list.reduce((sum, m) => sum + m.humanWaitMs, 0),
      accepted: list.reduce((sum, m) => sum + m.acceptedArtifacts, 0),
    };
  });
  readonly subjects = this.store.subjects;
  readonly subjectOfRun = computed(() => {
    const map = new Map<string, SubjectAnalysis>();
    for (const s of this.subjects()) for (const m of s.runs) map.set(m.run.id, s);
    return map;
  });
  readonly workflowSummary = this.store.workflowSummary;
  readonly budgetRatio = computed(() =>
    Math.min(1.2, this.store.tenantTokens() / this.store.tenant().budget.limitTokens),
  );
  readonly activity = computed(() => this.store.notifications().slice(0, 8));
  readonly now = computed(() => (this.store.runs(), this.store.app.now()));

  // ---- formatting

  euros(value: number | null | undefined): string {
    return formatEuros(value);
  }
  duration(ms: number): string {
    return formatDuration(ms);
  }
  delivered(run: Run): number {
    return run.steps.filter((s) => s.status === 'delivered').length;
  }
  progress(run: Run): number {
    return Math.round((this.delivered(run) / Math.max(1, run.steps.length)) * 100);
  }
  subjectTitle(run: Run): string | null {
    const s = this.subjectOfRun().get(run.id);
    return s?.item ? s.title : null;
  }
  subjectPath(run: Run): string | null {
    return this.subjectOfRun().get(run.id)?.item?.path ?? null;
  }
  name(actor: { kind: string; userId?: string }): string | null {
    if (actor.kind !== 'human' || !actor.userId) return null;
    return this.store.tenant().members.find((m) => m.userId === actor.userId)?.displayName ?? null;
  }
  conversationOf(gate: Gate): string | null {
    return this.store.validationConversationFor(gate.id)?.id ?? null;
  }
  fileNameOf(path: string): string {
    return fileName(path);
  }
  isActive(run: Run): boolean {
    return isRunActive(run);
  }

  // ---- analysis

  segments(m: RunMetrics, subject: SubjectAnalysis) {
    return runSegments(m.run, this.now()).map((seg) => ({
      ...seg,
      ...spanPercent(seg.from, seg.to, subject.from, subject.to),
      ms: new Date(seg.to).getTime() - new Date(seg.from).getTime(),
    }));
  }
  share(entry: Share, list: readonly Share[]): number {
    const max = Math.max(...list.map((s) => s.cost || s.tokens), 1);
    return Math.max(2, ((entry.cost || entry.tokens) / max) * 100);
  }
  workPercent(subject: SubjectAnalysis): number {
    const total = subject.totals.workingMs + subject.totals.humanWaitMs;
    return total === 0 ? 0 : Math.round((subject.totals.workingMs / total) * 100);
  }
  firstPassLabel(m: RunMetrics): string {
    if (m.firstPass === null) return 'in progress';
    return m.firstPass ? 'accepted first pass' : m.rejectedGates > 0 ? `${m.rejectedGates} gate rework` : 'not accepted';
  }

  // ---- activity

  open(n: Notification): void {
    if (n.readAt === null) this.store.markNotificationRead(n.id);
    if (n.refs.conversationId) void this.router.navigate(['/conversations', n.refs.conversationId]);
    else if (n.refs.runId) void this.router.navigate(['/supervisor', 'runs', n.refs.runId]);
  }
  icon(kind: Notification['kind']): string {
    switch (kind) {
      case 'gate-invitation':
        return 'pi pi-star-fill text-gate';
      case 'gate-decided':
        return 'pi pi-check-circle text-ok';
      case 'run-succeeded':
        return 'pi pi-check text-ok';
      case 'run-failed':
        return 'pi pi-times-circle text-fail';
      case 'run-cancelled':
        return 'pi pi-ban text-ink-light';
      case 'budget-alert':
        return 'pi pi-wallet text-warn';
      default:
        return 'pi pi-user-plus text-primary';
    }
  }
}
