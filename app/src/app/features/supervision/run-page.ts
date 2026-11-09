import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { formatDuration, formatEuros, type StepMetrics } from '../../core/application/analysis';
import type { Artifact } from '../../core/domain/artifact';
import { isRunActive, type Run, type StepRun } from '../../core/domain/run';
import { Actor } from '../../core/domain/types';
import { GateFlow } from '../../shared/gate-flow';
import { ActorBadge, ClockPipe, StatusBadge, TitlePipe, TokensPipe, actorLabel, fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { SaiStore } from '../../state/sai-store';

interface SessionRow {
  readonly key: string;
  readonly kind: 'orchestrator' | 'worker';
  readonly label: string;
  readonly actor: string;
  readonly sessionId: string;
  readonly step: StepRun | null;
  readonly metrics: StepMetrics | null;
}

/**
 * One run, interactive (Clément, 2026-11-09): its sessions on the left (the orchestrator and
 * one worker session per step), the selected session in the centre with its model, tokens,
 * cost, time, artifact (viewer), harness log, and its conversation to join (one session = one
 * conversation: the orchestrator's is the launching conversation, each worker has its own);
 * the gates as flows; statistics for the run.
 */
@Component({
  selector: 'sai-run-page',
  standalone: true,
  imports: [RouterLink, Button, Tooltip, GateFlow, Viewer, ActorBadge, ClockPipe, StatusBadge, TitlePipe, TokensPipe],
  templateUrl: './run-page.html',
})
export class RunPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  readonly run = computed(() => this.store.run(this.id()));
  readonly selected = signal<string | null>(null);
  readonly viewing = signal<string | null>(null);
  readonly showLog = signal(false);
  /** On a phone the sessions list is a sheet over the detail. */
  readonly listOpen = signal(false);

  readonly metrics = computed(() => (this.run() ? this.store.metricsOf(this.run() as Run) : null));
  readonly steps = computed(() => (this.run() ? this.store.stepMetricsOf(this.run() as Run) : []));
  readonly active = computed(() => (this.run() ? isRunActive(this.run() as Run) : false));
  readonly sessions = computed((): SessionRow[] => {
    const run = this.run();
    if (!run) return [];
    const orchestrator =
      this.store.organization().workflows.find((w) => w.slug === run.workflowSlug)?.orchestrator ?? 'orchestrator';
    return [
      {
        key: 'orchestrator',
        kind: 'orchestrator',
        label: 'Orchestrator',
        actor: orchestrator,
        sessionId: run.orchestratorSessionId,
        step: null,
        metrics: null,
      },
      ...run.steps.map((step) => ({
        key: step.stepSlug,
        kind: 'worker' as const,
        label: step.stepSlug,
        actor: step.actor,
        sessionId: step.sessionId,
        step,
        metrics: this.steps().find((m) => m.stepSlug === step.stepSlug) ?? null,
      })),
    ];
  });
  readonly current = computed((): SessionRow | null => this.sessions().find((s) => s.key === this.selected()) ?? null);
  readonly log = computed(() => (this.current() ? this.store.sessionLog(this.current()!.sessionId) : []));
  readonly viewed = computed((): Artifact | null => {
    const path = this.viewing();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });
  readonly conversationId = computed(() => this.run()?.conversationId ?? null);
  /** The worker session conversation of the selected step, if it started. */
  readonly sessionConversationId = computed(() => {
    const s = this.current();
    const run = this.run();
    if (!s || !run || s.kind !== 'worker') return null;
    return this.store.sessionConversation(run.id, s.key)?.id ?? null;
  });

  euros(value: number | null | undefined): string {
    return formatEuros(value);
  }
  duration(ms: number): string {
    return formatDuration(ms);
  }
  agent(slug: string) {
    return Actor.agent(slug);
  }
  label(actor: Parameters<typeof actorLabel>[0]): string {
    return actorLabel(actor, this.store.tenant().members);
  }
  fileName(path: string): string {
    return fileName(path);
  }
  select(key: string | null): void {
    this.selected.set(key);
    this.showLog.set(false);
    this.listOpen.set(false);
  }
  discuss(path: string): void {
    this.viewing.set(null);
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
