import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import { formatDuration, formatEuros } from '../../core/application/analysis';
import { isRunActive, runTokens, type Run } from '../../core/domain/run';
import { Actor } from '../../core/domain/types';
import { GateCard } from '../../shared/gate-card';
import { ActorBadge, ClockPipe, StatusBadge, TitlePipe, TokensPipe, actorLabel } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

/**
 * Run detail (F18-R2, F18-R3): what it cost in euros and how long it took (Clément, 2026-11-08),
 * steps with their cost and duration, verdicts, agents, models, artifacts, gates (decided in
 * their conversation) and journal; internals folded.
 */
@Component({
  selector: 'sai-run-page',
  standalone: true,
  imports: [RouterLink, Button, Tag, GateCard, ActorBadge, StatusBadge, TitlePipe, TokensPipe, ClockPipe],
  template: `
    @if (run(); as run) {
      <div class="px-6 py-5 max-md:px-4">
        <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <a class="text-sm" routerLink="/supervisor">← Supervisor</a>
            <h1 class="mt-1 text-2xl">
              {{ run.workflowSlug | title }}
              <span class="font-mono text-sm text-ink-light">{{ run.workflowInstanceId }}</span>
            </h1>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <sai-status [status]="run.status" />
              <span>launched by</span> <sai-actor [actor]="run.launchedBy" [displayName]="label(run.launchedBy)" />
              <span
                >· organization at <span class="font-mono">{{ run.organizationCommit.slice(0, 10) }}</span></span
              >
              <a [routerLink]="['/conversations', run.conversationId]">launching conversation</a>
            </div>
          </div>
          @if (active()) {
            <p-button
              label="Cancel run"
              icon="pi pi-stop"
              size="small"
              severity="danger"
              [outlined]="true"
              (onClick)="store.cancelRun(run.id)"
            />
          }
        </header>

        <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div class="sai-kpi">
            <span class="sai-kpi-label">AI cost</span>
            <span class="sai-kpi-value">{{ euros(metrics().cost) }}</span>
            <span class="sai-kpi-hint">{{ tokens().input | tokens }} in · {{ tokens().output | tokens }} out, rated by the gateway</span>
          </div>
          <div class="sai-kpi">
            <span class="sai-kpi-label">Duration</span>
            <span class="sai-kpi-value">{{ duration(metrics().durationMs) }}</span>
            <span class="sai-kpi-hint">{{ active() ? 'still running' : 'launch to end' }}</span>
          </div>
          <div class="sai-kpi">
            <span class="sai-kpi-label">Waiting for humans</span>
            <span class="sai-kpi-value" [class.text-gate]="run.status === 'waiting-for-gate'">{{ duration(metrics().humanWaitMs) }}</span>
            <span class="sai-kpi-hint">at ★ gates · agents at work {{ duration(metrics().workingMs) }}</span>
          </div>
          <div class="sai-kpi">
            <span class="sai-kpi-label">Steps delivered</span>
            <span class="sai-kpi-value">{{ delivered() }} / {{ run.steps.length }}</span>
            <span class="sai-kpi-hint">{{ metrics().acceptedArtifacts }} accepted · {{ metrics().rejectedGates }} gate rework</span>
          </div>
          <div class="sai-kpi">
            <span class="sai-kpi-label">Budget</span>
            <span class="sai-kpi-value">{{ tokens().total | tokens }} <span class="text-sm font-medium text-ink-muted">/ {{ run.budget.limitTokens | tokens }}</span></span>
            <div class="sai-progress mt-1" [class.is-fail]="tokens().total > run.budget.limitTokens">
              <span [style.width.%]="Math.min(100, (tokens().total / run.budget.limitTokens) * 100)"></span>
            </div>
          </div>
        </div>

        @for (gate of run.gates; track gate.id) {
          <div class="mb-4"><sai-gate-card [run]="run" [gate]="gate" /></div>
        }

        @if (run.failure) {
          <div class="sai-card mb-4 border-l-4 border-l-fail p-4 text-sm">
            <strong>{{ run.failure.code }}</strong> — {{ run.failure.message }}
          </div>
        }
        @if (run.partialArtifacts.length) {
          <div class="sai-card mb-4 p-4 text-sm">
            <strong>Partial artifacts kept</strong>
            <ul class="mt-1 list-disc pl-5">
              @for (p of run.partialArtifacts; track p) {
                <li>
                  <a [routerLink]="['/workspace']" [queryParams]="{ path: p }">{{ p }}</a>
                </li>
              }
            </ul>
          </div>
        }

        <section class="mb-5">
          <div class="mb-2 flex items-baseline justify-between">
            <h2 class="sai-eyebrow">Steps</h2>
            <span class="text-[11px] text-ink-light">1 step = 1 agent = 1 session = 1 artifact</span>
          </div>
          <div class="sai-card divide-y divide-line">
            @for (s of run.steps; track s.stepSlug) {
              <div class="flex flex-col gap-1.5 px-4 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <sai-status [status]="s.status" />
                    <strong>{{ s.stepSlug }}</strong>
                    <sai-actor [actor]="agent(s.actor)" />
                    @if (s.attempt > 1) {
                      <p-tag [value]="'attempt ' + s.attempt" severity="secondary" [rounded]="true" />
                    }
                  </div>
                  <div class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    @if (s.model) {
                      <span class="font-mono text-xs">{{ s.model.profile }}</span
                      ><span class="text-ink-light">score {{ s.model.score }} · cost rank {{ s.model.costRank }}</span>
                    }
                    <span>{{ s.tokens.input + s.tokens.output | tokens }} tokens</span>
                    @if (stepOf(s.stepSlug); as sm) {
                      <span class="font-semibold text-ink">{{ euros(sm.cost) }}</span>
                      @if (s.startedAt) {
                        <span class="text-ink-light">{{ duration(sm.durationMs) }}</span>
                      }
                    }
                  </div>
                </div>
                @if (s.artifactPath) {
                  <div class="text-sm">
                    → <a [routerLink]="['/workspace']" [queryParams]="{ path: s.artifactPath }">{{ s.artifactPath }}</a>
                    @if (s.commitSha) {
                      <span class="font-mono text-[11px] text-ink-light">{{ s.commitSha.slice(0, 10) }}</span>
                    }
                  </div>
                }
                <details class="sai-fold">
                  <summary>
                    Harness verdicts ({{ s.verdicts.length }}) · session
                    <span class="font-mono">{{ s.sessionId }}</span>
                  </summary>
                  <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                    @for (v of s.verdicts; track $index) {
                      <li class="flex flex-wrap items-center gap-2 text-sm">
                        <span class="font-mono text-xs">{{ v.fn }}</span
                        ><sai-status [status]="v.status" />
                        @if (v.detail) {
                          <span class="text-ink-muted">{{ v.detail }}</span>
                        }
                        <span class="text-[11px] text-ink-light">{{ v.at | clock }}</span>
                      </li>
                    }
                  </ul>
                  @if (s.model) {
                    <p class="m-0 mt-1 text-[11px] text-ink-light">
                      Model resolved by the harness rule: {{ s.model.reason }}. No model was called in this build.
                    </p>
                  }
                </details>
              </div>
            }
          </div>
        </section>

        <section class="mb-5">
          <details class="sai-fold">
            <summary>
              Journal: {{ journal().length }} harness log entries for this instance (append-only, read from the
              workspace logs)
            </summary>
            <div class="sai-card mt-2 overflow-x-auto">
              <table class="sai-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Function</th>
                    <th>Session</th>
                    <th>Parent</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of journal(); track $index) {
                    <tr>
                      <td class="text-ink-muted">{{ e.timestamp | clock }}</td>
                      <td class="font-mono text-xs">{{ e.report.context.function }}</td>
                      <td class="font-mono text-[11px]">{{ e.report.context.sessionId }}</td>
                      <td class="font-mono text-[11px] text-ink-light">
                        {{ e.report.context.parentSessionId ?? '—' }}
                      </td>
                      <td>
                        <sai-status [status]="e.report.outcome.status" />
                        @if (e.report.profile) {
                          <span class="font-mono text-[11px]">{{ e.report.profile.slug }}</span>
                        }
                        @if (e.report.artifactChecks?.length) {
                          <span class="text-ink-muted">{{ e.report.artifactChecks![0].failureMessage }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section>
          <details class="sai-fold">
            <summary>Usage attribution: {{ usage().length }} records (F3)</summary>
            <div class="sai-card mt-2 overflow-x-auto">
              <table class="sai-table">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Model</th>
                    <th>Source</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Tenant</th>
                  </tr>
                </thead>
                <tbody>
                  @for (u of usage(); track u.id) {
                    <tr>
                      <td>{{ u.stepSlug }}</td>
                      <td class="font-mono text-xs">{{ u.model }}</td>
                      <td>{{ u.source }}</td>
                      <td>{{ u.tokensIn | tokens }}</td>
                      <td>{{ u.tokensOut | tokens }}</td>
                      <td class="font-mono text-xs">{{ u.tenantId }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    } @else {
      <div class="px-6 py-5"><div class="sai-empty">This run is not accessible.</div></div>
    }
  `,
})
export class RunPage {
  readonly store = inject(SaiStore);
  readonly id = input.required<string>();
  readonly Math = Math;
  readonly run = computed(() => this.store.run(this.id()));
  readonly active = computed(() => {
    const run = this.run();
    return run ? isRunActive(run) : false;
  });
  readonly delivered = computed(() => this.run()?.steps.filter((s) => s.status === 'delivered').length ?? 0);
  readonly tokens = computed(() => (this.run() ? runTokens(this.run() as Run) : { input: 0, output: 0, total: 0 }));
  readonly metrics = computed(() => this.store.metricsOf(this.run() as Run));
  readonly steps = computed(() => this.store.stepMetricsOf(this.run() as Run));
  readonly journal = computed(() => {
    const run = this.run();
    return run
      ? this.store.journal().filter((e) => e.report.context.workflowInstanceId === run.workflowInstanceId)
      : [];
  });
  readonly usage = computed(() => (this.run() ? this.store.usageForRun(this.id()) : []));

  agent(slug: string) {
    return Actor.agent(slug);
  }
  stepOf(slug: string) {
    return this.steps().find((s) => s.stepSlug === slug) ?? null;
  }
  euros(value: number | null): string {
    return formatEuros(value);
  }
  duration(ms: number): string {
    return formatDuration(ms);
  }
  label(actor: Parameters<typeof actorLabel>[0]): string {
    return actorLabel(actor, this.store.tenant().members);
  }
}
