import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { formatDuration, formatEuros, runSegments, spanPercent, type RunMetrics, type Share, type SubjectAnalysis } from '../../core/application/analysis';
import { isRunActive, type Run } from '../../core/domain/run';
import { AgoPipe, StatusBadge, TitlePipe, TokensPipe } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

type StatusFilter = 'all' | 'active' | 'waiting' | 'done' | 'failed';
type RoleFilter = 'all' | 'launcher' | 'holder' | 'participant';
type View = 'runs' | 'statistics';

/**
 * Supervision › Runs (Clément, 2026-11-09): executing and executed workflows by status and
 * by the user's role, active runs animated, with real-time and past statistics (tokens, cost,
 * time, sessions, humans and agents involved) for all runs and by subject.
 */
@Component({
  selector: 'sai-runs-page',
  standalone: true,
  imports: [RouterLink, Button, Tooltip, AgoPipe, StatusBadge, TitlePipe, TokensPipe],
  templateUrl: './runs-page.html',
})
export class RunsPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly view = signal<View>('runs');
  readonly status = signal<StatusFilter>('all');
  readonly role = signal<RoleFilter>('all');

  readonly metrics = computed(() => [...this.store.runMetrics()].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt)));
  readonly rows = computed(() =>
    this.metrics().filter((m) => {
      const s = m.run.status;
      const statusOk =
        this.status() === 'all' ||
        (this.status() === 'active' && (s === 'queued' || s === 'running')) ||
        (this.status() === 'waiting' && s === 'waiting-for-gate') ||
        (this.status() === 'done' && s === 'succeeded') ||
        (this.status() === 'failed' && (s === 'failed' || s === 'cancelled'));
      const roleOk = this.role() === 'all' || this.store.myRoleInRun(m.run) === this.role();
      return statusOk && roleOk;
    }),
  );
  readonly subjects = this.store.subjects;
  readonly subjectOfRun = computed(() => {
    const map = new Map<string, SubjectAnalysis>();
    for (const s of this.subjects()) for (const m of s.runs) map.set(m.run.id, s);
    return map;
  });
  readonly workflowSummary = this.store.workflowSummary;
  readonly now = computed(() => (this.store.runs(), this.store.app.now()));
  readonly totals = computed(() => {
    const list = this.store.runMetrics();
    const runs = this.store.runs();
    const conversations = this.store.conversations();
    const humans = new Set<string>();
    const agents = new Set<string>();
    for (const run of runs) {
      for (const step of run.steps) agents.add(step.actor);
      const c = conversations.find((x) => x.id === run.conversationId);
      for (const p of c?.participants ?? []) if (p.status === 'joined') (p.actor.kind === 'human' ? humans : agents).add(p.actor.kind === 'human' ? p.actor.userId : p.actor.slug);
    }
    return {
      active: runs.filter((r) => isRunActive(r)).length,
      total: runs.length,
      sessions: runs.reduce((sum, r) => sum + 1 + r.steps.filter((s) => s.startedAt !== null).length, 0),
      humans: humans.size,
      agents: agents.size,
      tokens: list.reduce((sum, m) => sum + m.tokens, 0),
      cost: list.reduce((sum, m) => sum + (m.cost ?? 0), 0),
      workingMs: list.reduce((sum, m) => sum + m.workingMs, 0),
      humanWaitMs: list.reduce((sum, m) => sum + m.humanWaitMs, 0),
      accepted: list.reduce((sum, m) => sum + m.acceptedArtifacts, 0),
    };
  });

  euros(value: number | null | undefined): string {
    return formatEuros(value);
  }
  duration(ms: number): string {
    return formatDuration(ms);
  }
  runScenario(): void {
    const conversation = this.store.runScenario();
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
  isActive(run: Run): boolean {
    return run.status === 'queued' || run.status === 'running';
  }
  delivered(run: Run): number {
    return run.steps.filter((s) => s.status === 'delivered').length;
  }
  progress(run: Run): number {
    return Math.round((this.delivered(run) / Math.max(1, run.steps.length)) * 100);
  }
  currentStep(run: Run): string | null {
    return run.steps.find((s) => s.status === 'running')?.stepSlug ?? null;
  }
  subjectTitle(run: Run): string | null {
    const s = this.subjectOfRun().get(run.id);
    return s?.item ? s.title : null;
  }
  roleLabel(run: Run): string {
    return { launcher: 'I launched', holder: 'I decide its gates', participant: 'I take part', observer: 'observer' }[this.store.myRoleInRun(run)];
  }
  count(status: StatusFilter): number {
    const prev = this.status();
    this.status.set(status);
    const n = this.rows().length;
    this.status.set(prev);
    return n;
  }
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
  firstPassLabel(m: RunMetrics): string {
    if (m.firstPass === null) return 'in progress';
    return m.firstPass ? 'accepted first pass' : m.rejectedGates > 0 ? `${m.rejectedGates} gate rework` : 'not accepted';
  }
}
