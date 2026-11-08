import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tag } from 'primeng/tag';
import type { Notification } from '../../core/domain/notification';
import { runTokens, type Run } from '../../core/domain/run';
import { GateCard } from '../../shared/gate-card';
import { ActorBadge, AgoPipe, StatusBadge, TitlePipe, TokensPipe } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

/**
 * Supervisor (F18-R4), proposed as the home: what waits for the user (★ gates with their
 * validation conversations), the runs of the workspace, the activity feed (notifications),
 * the budget and the model deployments the tenant may use. Read-only; actions go through
 * gates and runs.
 */
@Component({
  selector: 'sai-supervisor-page',
  standalone: true,
  imports: [RouterLink, Button, Tag, GateCard, StatusBadge, ActorBadge, TitlePipe, TokensPipe, AgoPipe],
  templateUrl: './supervisor-page.html',
})
export class SupervisorPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly waiting = this.store.gatesWaitingForMe;
  readonly active = computed(() =>
    this.store.runs().filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting-for-gate'),
  );
  readonly past = computed(() =>
    this.store
      .runs()
      .filter((r) => r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled')
      .slice(0, 8),
  );
  readonly failed = computed(() => this.store.runs().filter((r) => r.status === 'failed'));
  readonly budgetRatio = computed(() =>
    Math.min(1.2, this.store.tenantTokens() / this.store.tenant().budget.limitTokens),
  );
  readonly activity = computed(() => this.store.notifications().slice(0, 10));
  readonly decisions = computed(() =>
    this.store
      .runs()
      .flatMap((run) => run.gates.filter((g) => g.status !== 'pending').map((gate) => ({ run, gate })))
      .sort((a, b) => (b.gate.decidedAt ?? '').localeCompare(a.gate.decidedAt ?? ''))
      .slice(0, 5),
  );

  delivered(run: Run): number {
    return run.steps.filter((s) => s.status === 'delivered').length;
  }
  progress(run: Run): number {
    return Math.round((this.delivered(run) / Math.max(1, run.steps.length)) * 100);
  }
  tokens(run: Run): number {
    return runTokens(run).total;
  }
  name(actor: { kind: string; userId?: string }): string | null {
    if (actor.kind !== 'human' || !actor.userId) return null;
    return this.store.tenant().members.find((m) => m.userId === actor.userId)?.displayName ?? null;
  }
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
