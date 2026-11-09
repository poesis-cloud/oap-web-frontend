import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { changePath, readChange } from '../core/domain/improvement';
import type { RunMetrics } from '../core/application/analysis';
import { SaiStore } from '../state/sai-store';
import { DiffView } from './diff-view';
import { EurPipe, DurationPipe } from './ui';

@Component({
  selector: 'sai-change-review', standalone: true, imports: [DiffView, RouterLink, EurPipe, DurationPipe],
  template: `
    @if (change(); as c) {
      <section class="sai-card my-3 overflow-hidden" aria-label="Organization change review">
        <div class="border-b border-line bg-surface-sunken p-4">
          <div class="flex flex-wrap items-center justify-between gap-2"><h2 class="m-0 text-base font-semibold">{{ c.operation === 'rollback' ? 'Rollback' : 'ADR preflight' }} · proposed diff</h2><span class="sai-chip">Frontend simulation</span></div>
          <p class="mb-0 text-sm text-ink-muted">{{ c.intent }}</p>
          <p class="mb-0 break-all font-mono text-xs text-ink-muted">{{ c.target }}</p>
        </div>
        <div class="flex flex-col gap-4 p-4">
          <sai-diff [before]="c.before" [after]="c.after" />
          <p class="m-0 text-sm text-ink-muted">{{ applied() ? 'This revision was accepted. The observation window counts only completed runs started with these exact instructions.' : 'Approval applies this exact diff. The current instruction must still match the reviewed baseline. A rollback requires its own run and gate.' }}</p>
          @if (c.revertsRunId) { <a [routerLink]="['/supervision/runs', c.revertsRunId]" class="text-sm">Original change · {{ c.revertsRunId }}</a> }
          <div>
            <h3 class="m-0 text-sm font-semibold">Scorecard <span class="font-normal text-ink-muted">· {{ after().length }} / 3 observation runs</span></h3>
            <p class="my-2 text-xs text-ink-muted">{{ after().length >= 3 ? 'Observation window reached. Compare the evidence before deciding whether the pain point is resolved.' : 'Insufficient observations. No measured improvement is claimed.' }} Costs and runtimes are simulated.</p>
            <div class="overflow-x-auto"><table class="sai-table">
              <thead><tr><th>Measure</th><th>Baseline · {{ before().length }} runs</th><th>After approval · {{ after().length }} runs</th></tr></thead>
              <tbody>
                <tr><td>AI cost / accepted artifact</td><td>{{ costPerArtifact(before()) | eur }}</td><td>{{ costPerArtifact(after()) | eur }}</td></tr>
                <tr><td>First-pass human acceptance</td><td>{{ firstPass(before()) }}</td><td>{{ firstPass(after()) }}</td></tr>
                <tr><td>Human gate returns</td><td>{{ returns(before()) }}</td><td>{{ returns(after()) }}</td></tr>
                <tr><td>Missing-status recurrences</td><td>{{ recurrences(before()) }}</td><td>{{ recurrences(after()) }}</td></tr>
              </tbody>
            </table></div>
            <div class="mt-2 flex flex-wrap gap-3 text-xs">@for (m of before().concat(after()); track m.run.id) { <a [routerLink]="['/supervision/runs', m.run.id]">{{ m.run.id }} · {{ m.cost | eur }} · {{ m.durationMs | duration }}</a> }</div>
          </div>
        </div>
      </section>
    }
  `,
})
export class ChangeReview {
  readonly store = inject(SaiStore);
  readonly runId = input.required<string>();
  readonly change = computed(() => readChange(this.store.artifacts().find(a => a.path === changePath(this.runId()))?.head.content ?? null));
  readonly applied = computed(() => this.store.run(this.runId())?.status === 'succeeded');
  readonly before = computed(() => this.store.runMetrics().filter(m => this.change()?.baselineRunIds.includes(m.run.id)));
  readonly after = computed(() => {
    const c = this.change();
    const appliedAt = this.store.run(this.runId())?.endedAt;
    if (!c || !this.applied() || !appliedAt) return [];
    const commits = this.store.commits();
    return this.store.runMetrics().filter(m => {
      if (m.run.workflowSlug !== 'architectural-runway-extension' || !m.run.endedAt || m.run.startedAt <= appliedAt) return false;
      let content: string | null = null;
      for (const commit of commits) {
        if (Object.hasOwn(commit.changes, c.target)) content = commit.changes[c.target];
        if (commit.sha === m.run.organizationCommit) break;
      }
      return content === c.after;
    });
  });
  costPerArtifact(rows: readonly RunMetrics[]): number | null {
    const accepted = rows.reduce((n,m) => n + m.acceptedArtifacts, 0);
    return accepted && rows.every(m => m.cost !== null) ? rows.reduce((n,m) => n + (m.cost ?? 0), 0) / accepted : null;
  }
  firstPass(rows: readonly RunMetrics[]): string { return rows.length ? `${Math.round(rows.filter(m => m.firstPass).length / rows.length * 100)}%` : '—'; }
  returns(rows: readonly RunMetrics[]): string { return rows.length ? String(rows.reduce((n,m) => n + m.rejectedGates, 0)) : '—'; }
  recurrences(rows: readonly RunMetrics[]): string { return rows.length ? String(rows.reduce((n,m) => n + m.run.steps.flatMap(s => s.verdicts).filter(v => v.status === 'reverted' && v.detail?.includes('frontmatter.status')).length, 0)) : '—'; }
}
