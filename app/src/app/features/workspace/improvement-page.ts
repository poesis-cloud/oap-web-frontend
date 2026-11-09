import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { SaiStore } from '../../state/sai-store';
import { Viewer } from '../../shared/viewer';
import { ChangeReview } from '../../shared/change-review';
import { StatusBadge, EurPipe, DurationPipe } from '../../shared/ui';
import { parseArtifact } from '../../core/saf/frontmatter';

@Component({
  selector: 'sai-improvement-page', standalone: true,
  host: { class: 'flex h-full min-h-0 flex-col' },
  imports: [RouterLink, Button, Viewer, StatusBadge, EurPipe, DurationPipe, ChangeReview],
  template: `
    <div class="pane-bar bg-surface"><span class="pane-title">Improvement</span><span class="pane-spacer"></span><p-button label="Start retrospective" icon="pi pi-comments" size="small" [disabled]="!openPains().length" (onClick)="retrospective()" /></div>
    <div class="pane-body p-4 md:p-6">
      <div class="mx-auto max-w-6xl">
        <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><div class="sai-eyebrow mb-2">Learn from the work</div><h1 class="m-0 text-2xl font-semibold tracking-tight">From friction to a better organization.</h1><p class="mb-0 max-w-2xl text-sm text-ink-muted">Trace a rejected write, discuss its cause, review a bounded change and measure what happens next.</p></div>
          <a routerLink="/supervision/organization" class="text-sm">Organization history →</a>
        </div>
        <div class="mb-6 grid gap-2 sm:grid-cols-4">
          @for (s of stages; track s.title; let i = $index) { <div class="sai-card p-3"><span class="mr-2 text-ai">0{{ i + 1 }}</span><strong class="text-sm">{{ s.title }}</strong><p class="mb-0 mt-1 text-xs text-ink-muted">{{ s.text }}</p></div> }
        </div>
        <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-label="Pain points">
            <div class="mb-3 flex items-center justify-between"><h2 class="sai-eyebrow m-0">Pain points · {{ pains().length }}</h2><span class="text-xs text-ink-muted">{{ openPains().length }} to follow up</span></div>
            <div class="grid gap-3 md:grid-cols-2">
              @for (pain of pains(); track pain.path) {
                <article class="sai-card flex flex-col gap-3 border-t-2 border-t-ai p-4">
                  <div class="flex items-start justify-between gap-2"><span class="font-mono text-xs text-ink-light">{{ pain.itemId }}</span><sai-status [status]="pain.status" /></div>
                  <button type="button" class="border-0 bg-transparent p-0 text-left text-base font-semibold text-ink" (click)="viewing.set(pain.path)">{{ pain.title }}</button>
                  <p class="m-0 text-sm text-ink-muted">{{ field(pain.path, 'symptom') }}</p>
                  <div class="text-xs text-ink-muted">Owner · Release Train Engineer</div>
                  <div class="flex flex-wrap gap-3 text-xs"><button type="button" class="text-primary" (click)="viewing.set(pain.path)">Read evidence</button><a [routerLink]="['/supervision/runs', field(pain.path, 'sourceRun')]">Source run →</a>@if (sourceSession(pain.path); as id) { <a [routerLink]="['/conversation', id]">Rejected session →</a> }</div>
                  <p-button label="Propose an improvement" icon="pi pi-arrow-right" size="small" [outlined]="true" (onClick)="propose(pain.path)" />
                </article>
              } @empty { <div class="sai-card p-6 text-sm text-ink-muted md:col-span-2">No pain points yet. Record a rejected write from the evidence panel, or run the architecture scenario to observe the commit gate.</div> }
            </div>
          </section>
          <aside class="sai-card self-start p-4" aria-label="Observed friction">
            <h2 class="sai-eyebrow mb-3">Observed friction</h2>
            <p class="mt-0 text-xs text-ink-muted">Harness rejections from this workspace. Each capture runs improvement-backlog for one pain point.</p>
            <div class="flex flex-col gap-4">@for (signal of signals(); track signal.run.id + signal.step.stepSlug) {
              <div class="border-t border-line pt-3"><a class="text-sm font-semibold" [routerLink]="['/supervision/runs', signal.run.id]">{{ signal.run.id }} · {{ signal.step.stepSlug }}</a><p class="my-2 text-xs text-ink-muted">{{ signal.reason }}</p><p-button label="Record pain point" size="small" [text]="true" [disabled]="captured(signal.run.id, signal.step.stepSlug)" (onClick)="capture(signal.run.id)" />@if (captured(signal.run.id, signal.step.stepSlug)) { <span class="text-xs text-ok">Recorded</span> }</div>
            } @empty { <p class="text-sm text-ink-muted">No commit-gate rejections observed.</p> }</div>
          </aside>
        </div>
        <section class="mt-6" aria-label="Improvement conversations"><h2 class="sai-eyebrow mb-2">Retrospectives</h2><div class="flex flex-wrap gap-2">@for (c of retrospectives(); track c.id) { <a class="sai-card p-3 text-sm" [routerLink]="['/conversation', c.id]">{{ c.title }} · {{ c.threads.length - 1 }} pain-point threads →</a> } @empty { <p class="text-sm text-ink-muted">Start a retrospective to discuss each open pain point in its own thread.</p> }</div></section>
        <section class="mt-6" aria-label="Organization changes">
          <div class="mb-3 flex items-center justify-between"><h2 class="sai-eyebrow m-0">Changes & observation</h2><p-button label="Propose a rollback" icon="pi pi-undo" size="small" [text]="true" [disabled]="!store.organizationGap().length" (onClick)="rollback()" /></div>
          @for (r of changes(); track r.id) {
            <details class="sai-card mb-3 p-4" open><summary class="cursor-pointer"><span class="mr-3 font-semibold">{{ r.id }}</span><sai-status [status]="r.status" /><span class="ml-3 text-xs text-ink-muted">{{ store.metricsOf(r).cost | eur }} · {{ store.metricsOf(r).durationMs | duration }}</span></summary><div class="mt-3 flex gap-4 text-sm"><a [routerLink]="['/conversation', r.conversationId]">Open the gate conversation →</a><a [routerLink]="['/supervision/runs', r.id]">Run & sessions</a></div><sai-change-review [runId]="r.id" /></details>
          } @empty { <div class="sai-card p-5 text-sm text-ink-muted">No organization changes yet. A proposal starts in conversation; only its approved gate changes the instructions.</div> }
        </section>
      </div>
    </div>
    @if (viewed(); as a) { <sai-viewer [artifact]="a" [overlay]="true" (close)="viewing.set(null)" (discuss)="propose(a.path)" /> }
  `,
})
export class ImprovementPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly viewing = signal<string | null>(null);
  readonly viewed = computed(() => this.store.artifacts().find(a => a.path === this.viewing()) ?? null);
  readonly pains = computed(() => this.store.workItems().filter(i => i.type === 'pain-point'));
  readonly openPains = computed(() => this.pains().filter(i => ['open', 'triaged'].includes(i.status)));
  readonly retrospectives = computed(() => this.store.conversations().filter(c => c.title.startsWith('Retrospective')));
  readonly changes = computed(() => this.store.runs().filter(r => r.workflowSlug === 'organization-change'));
  readonly signals = computed(() => this.store.runs().flatMap(run => run.steps.filter(step => step.verdicts.some(v => v.fn === 'check-step-artifact' && v.status === 'reverted')).map(step => ({ run, step, reason: step.verdicts.find(v => v.status === 'reverted')?.detail }))));
  readonly stages = [{ title: 'Observe', text: 'A rejection with its run and verdict.' }, { title: 'Discuss', text: 'One thread per pain point.' }, { title: 'Change', text: 'A diff and a human gate.' }, { title: 'Measure', text: 'A scorecard and a rollback path.' }];
  field(path: string, key: string): string { const a = this.store.artifacts().find(a => a.path === path); return a ? String(parseArtifact(a.head.content).frontmatter[key] ?? '') : ''; }
  sourceSession(path: string): string | null { const session = this.field(path, 'sourceSession'); return this.store.conversations().find(c => c.sessionRef?.sessionId === session)?.id ?? null; }
  captured(runId: string, step: string): boolean { return this.pains().some(p => this.field(p.path, 'sourceRun') === runId && this.field(p.path, 'sourceStep') === step); }
  private open(c: { id: string } | null): void { if (c) void this.router.navigate(['/conversation', c.id]); }
  capture(runId: string): void { this.open(this.store.startConversation('Record commit-gate friction', `/improvement-backlog Record the rejected write from ${runId}`)); }
  retrospective(): void { this.open(this.store.startRetrospective()); }
  propose(path: string): void { this.open(this.store.startConversation('Improve ADR preflight', '/organization-change Prevent missing ADR status with a preflight instruction; retain harness validation.', path)); }
  rollback(): void { this.open(this.store.proposeOrganizationAction('rollback')); }
}
