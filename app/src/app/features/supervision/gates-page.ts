import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import type { Artifact } from '../../core/domain/artifact';
import type { Gate, Run } from '../../core/domain/run';
import { GateFlow } from '../../shared/gate-flow';
import { ActorBadge, AgoPipe, StatusBadge, TitlePipe, fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { SaiStore } from '../../state/sai-store';

type StatusFilter = 'all' | 'pending' | 'decided';
type RoleFilter = 'all' | 'holder' | 'requester' | 'participant';

interface GateRow {
  readonly run: Run;
  readonly gate: Gate;
  readonly role: 'holder' | 'requester' | 'participant' | 'observer';
  readonly conversationId: string | null;
}

/**
 * Supervision › Gates (Clément, 2026-11-09): every ★ gate of the workspace by status and by
 * the user's role in it. A gate is a conversation: the row leads there, where the decision
 * is taken. The gates waiting for the user show their four-step flow first.
 */
@Component({
  selector: 'sai-gates-page',
  standalone: true,
  imports: [RouterLink, Button, GateFlow, Viewer, ActorBadge, AgoPipe, StatusBadge, TitlePipe],
  template: `
    <div class="panes" style="grid-template-columns: minmax(0, 1fr)">
      <section class="pane is-content is-canvas" aria-label="Gates">
        <div class="pane-bar bg-surface">
          <div class="sai-segment" role="tablist" aria-label="Status">
            <button type="button" role="tab" [class.is-on]="status() === 'all'" (click)="status.set('all')">All</button>
            <button type="button" role="tab" [class.is-on]="status() === 'pending'" (click)="status.set('pending')">Pending <span class="text-ink-light">{{ count('pending') }}</span></button>
            <button type="button" role="tab" [class.is-on]="status() === 'decided'" (click)="status.set('decided')">Decided <span class="text-ink-light">{{ count('decided') }}</span></button>
          </div>
          <div class="sai-segment max-md:hidden" role="tablist" aria-label="My role">
            <button type="button" role="tab" [class.is-on]="role() === 'all'" (click)="role.set('all')">Any role</button>
            <button type="button" role="tab" [class.is-on]="role() === 'holder'" (click)="role.set('holder')">I decide</button>
            <button type="button" role="tab" [class.is-on]="role() === 'requester'" (click)="role.set('requester')">I requested</button>
            <button type="button" role="tab" [class.is-on]="role() === 'participant'" (click)="role.set('participant')">I take part</button>
          </div>
        </div>
        <div class="pane-body p-4">
          @if (waiting().length > 0) {
            <h2 class="sai-eyebrow mb-2">Waiting for your decision</h2>
            <div class="mb-5 flex flex-col gap-3">
              @for (row of waiting(); track row.gate.id) {
                <sai-gate-flow [run]="row.run" [gate]="row.gate" (review)="viewing.set($event)" />
              }
            </div>
          }
          @if (rows().length === 0) {
            <div class="p-10 text-center text-sm text-ink-muted">No gate here. Every decision of this workspace is taken at a ★ gate, inside its conversation.</div>
          } @else {
            <div class="sai-card overflow-x-auto">
              <table class="sai-table">
                <thead>
                  <tr>
                    <th>Gate</th>
                    <th>Artifact</th>
                    <th>Run</th>
                    <th>Status</th>
                    <th>My role</th>
                    <th>Decided by</th>
                    <th>When</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.gate.id) {
                    <tr class="cursor-pointer hover:bg-surface-sunken" (click)="open(row)">
                      <td class="whitespace-nowrap"><span class="text-gate">★</span> {{ row.gate.label }}</td>
                      <td><button type="button" class="text-primary" (click)="viewing.set(row.gate.artifactPath); $event.stopPropagation()">{{ fileName(row.gate.artifactPath) }}</button></td>
                      <td><a [routerLink]="['/supervision', 'runs', row.run.id]" (click)="$event.stopPropagation()">{{ row.run.workflowSlug | title }}</a></td>
                      <td><sai-status [status]="row.gate.status" /></td>
                      <td>{{ roleLabel(row.role) }}</td>
                      <td>
                        @if (row.gate.decidedBy; as by) {
                          <sai-actor [actor]="by" />
                        } @else {
                          <span class="text-ink-light">holders of {{ row.gate.holderRole }}</span>
                        }
                      </td>
                      <td class="whitespace-nowrap text-ink-muted">{{ row.gate.decidedAt ?? row.gate.raisedAt | ago }}</td>
                      <td>
                        @if (row.conversationId) {
                          <p-button [label]="row.gate.status === 'pending' && row.role === 'holder' ? 'Decide' : 'Open'" icon="pi pi-comments" size="small" [outlined]="!(row.gate.status === 'pending' && row.role === 'holder')" [severity]="row.gate.status === 'pending' && row.role === 'holder' ? 'primary' : 'secondary'" [routerLink]="['/conversation', row.conversationId]" (click)="$event.stopPropagation()" />
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
        @if (viewed(); as a) {
          <sai-viewer [artifact]="a" [overlay]="true" (close)="viewing.set(null)" (discuss)="discuss($event)" />
        }
      </section>
    </div>
  `,
})
export class GatesPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly status = signal<StatusFilter>('all');
  readonly role = signal<RoleFilter>('all');
  readonly viewing = signal<string | null>(null);

  readonly all = computed((): GateRow[] =>
    this.store
      .runs()
      .flatMap((run) =>
        run.gates.map((gate) => ({
          run,
          gate,
          role: this.store.myRoleInGate(run, gate),
          conversationId: this.store.validationConversationFor(gate.id)?.id ?? null,
        })),
      )
      .sort((a, b) => {
        if ((a.gate.status === 'pending') !== (b.gate.status === 'pending')) return a.gate.status === 'pending' ? -1 : 1;
        return (b.gate.decidedAt ?? b.gate.raisedAt).localeCompare(a.gate.decidedAt ?? a.gate.raisedAt);
      }),
  );
  readonly rows = computed(() =>
    this.all().filter(
      (r) =>
        (this.status() === 'all' || (this.status() === 'pending') === (r.gate.status === 'pending')) &&
        (this.role() === 'all' || r.role === this.role()),
    ),
  );
  readonly waiting = computed(() => this.all().filter((r) => r.gate.status === 'pending' && r.role === 'holder'));
  readonly viewed = computed((): Artifact | null => {
    const path = this.viewing();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });

  count(status: StatusFilter): number {
    return this.all().filter((r) => (status === 'pending') === (r.gate.status === 'pending')).length;
  }
  roleLabel(role: GateRow['role']): string {
    return { holder: 'I decide', requester: 'I requested', participant: 'I take part', observer: 'observer' }[role];
  }
  fileName(path: string): string {
    return fileName(path);
  }
  open(row: GateRow): void {
    if (row.conversationId) void this.router.navigate(['/conversation', row.conversationId]);
  }
  discuss(path: string): void {
    this.viewing.set(null);
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
