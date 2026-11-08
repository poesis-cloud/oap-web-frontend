import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import type { Gate, Run } from '../core/domain/run';
import { holdsRole } from '../core/domain/workspace';
import { SaiStore } from '../state/sai-store';
import { ActorBadge, AgoPipe, StatusBadge, fileName } from './ui';

/**
 * The human ★ gate (F4-R3). **A gate is a conversation** (Clément, 2026-11-08): the decision
 * is taken only inside the validation conversation the gate opened, where the holders of the
 * declared role, the requester and the agents of the run discuss the artifact. Everywhere
 * else (Supervisor, board, run detail, launching conversation) the card is a summary that
 * leads to that conversation. `mode="decide"` is set only by the validation conversation.
 * The decision goes through the runtime and becomes a validated workspace commit; the UI
 * never writes.
 */
@Component({
  selector: 'sai-gate-card',
  standalone: true,
  imports: [FormsModule, RouterLink, Button, Textarea, StatusBadge, ActorBadge, AgoPipe],
  template: `
    <section
      class="sai-card flex flex-col gap-3 border-l-4 border-l-gate p-4"
      [class.bg-gate-tint]="gate().status === 'pending'"
      [attr.aria-label]="gate().label"
    >
      <header class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-gate" aria-hidden="true">★</span>
          <strong>{{ gate().label }}</strong>
          <sai-status [status]="gate().status" />
          @if (gate().status === 'pending') {
            <span class="text-xs text-ink-light">raised {{ gate().raisedAt | ago }}</span>
          }
        </div>
        <span class="text-xs text-ink-light"
          >decided by holders of <code>{{ gate().holderRole }}</code></span
        >
      </header>

      <p class="m-0 text-sm text-ink-muted">
        Review
        <a [routerLink]="['/workspace']" [queryParams]="{ path: gate().artifactPath }">{{ artifactName() }}</a> produced
        by run <a [routerLink]="['/supervisor', 'runs', run().id]">{{ run().workflowInstanceId }}</a
        >.
        @if (gate().status === 'pending') {
          The run waits; nothing is auto-approved.
        }
      </p>

      @if (mode() === 'decide') {
        @if (gate().status === 'pending') {
          @if (mayDecide()) {
            <label class="text-xs text-ink-muted" for="c-{{ gate().id }}"
              >Comment (required to reject or to approve with a reservation)</label
            >
            <textarea
              pTextarea
              class="w-full"
              id="c-{{ gate().id }}"
              rows="2"
              [ngModel]="comment()"
              (ngModelChange)="comment.set($event)"
              placeholder="What should change, or what reservation do you record?"
            ></textarea>
            <div class="flex flex-wrap items-center gap-2">
              <p-button label="Approve" icon="pi pi-check" size="small" (onClick)="decide('approved')" />
              <p-button
                label="Approve with reservation"
                icon="pi pi-flag"
                size="small"
                severity="secondary"
                [outlined]="true"
                [disabled]="!comment().trim()"
                (onClick)="decide('approved-with-reservation')"
              />
              <p-button
                label="Reject"
                icon="pi pi-times"
                size="small"
                severity="danger"
                [outlined]="true"
                [disabled]="!comment().trim()"
                (onClick)="decide('rejected')"
              />
              <span class="text-xs text-ink-light">review time {{ elapsed() }}s</span>
            </div>
          } @else {
            <p class="m-0 text-sm text-ink-light">
              You do not hold the role <code>{{ gate().holderRole }}</code
              >; the decision belongs to its holders, here in this conversation.
            </p>
          }
        }
      } @else if (gate().status === 'pending') {
        <div class="flex flex-wrap items-center gap-2">
          @if (conversationId(); as id) {
            <p-button
              [label]="mayDecide() ? 'Decide in the gate conversation' : 'Open the gate conversation'"
              icon="pi pi-comments"
              size="small"
              [severity]="mayDecide() ? 'primary' : 'secondary'"
              [outlined]="!mayDecide()"
              [routerLink]="['/conversations', id]"
            />
          } @else {
            <span class="text-sm text-ink-light"
              >The gate is a conversation between the holders of <code>{{ gate().holderRole }}</code
              >, the requester and the agents of the run; you are not part of it.</span
            >
          }
        </div>
      }

      @if (gate().status !== 'pending') {
        <div class="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          @if (gate().decidedBy; as by) {
            <span>Decided by</span> <sai-actor [actor]="by" />
          }
          @if (gate().comment) {
            <span>— “{{ gate().comment }}”</span>
          }
          @if (gate().reviewerSeconds !== null) {
            <span class="text-ink-light">· {{ gate().reviewerSeconds }}s of review</span>
          }
          @if (mode() !== 'decide' && conversationId(); as id) {
            <a [routerLink]="['/conversations', id]"><i class="pi pi-comments text-[0.8em]"></i> gate conversation</a>
          }
        </div>
      }
    </section>
  `,
})
export class GateCard {
  private readonly store = inject(SaiStore);
  readonly run = input.required<Run>();
  readonly gate = input.required<Gate>();
  /** `decide` only inside the validation conversation; `link` everywhere else. */
  readonly mode = input<'decide' | 'link'>('link');
  readonly comment = signal('');
  private readonly openedAt = Date.now();
  private readonly now = signal(Date.now());

  readonly artifactName = computed(() => fileName(this.gate().artifactPath));
  readonly mayDecide = computed(() =>
    holdsRole(this.store.tenant(), this.store.session().userId, this.gate().holderRole),
  );
  readonly elapsed = computed(() => Math.round((this.now() - this.openedAt) / 1000));
  readonly conversationId = computed(() => this.store.validationConversationFor(this.gate().id)?.id ?? null);

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    void timer; // lives as long as the card; the view tears it down with the component
  }

  decide(decision: 'approved' | 'approved-with-reservation' | 'rejected'): void {
    const seconds = Math.max(1, Math.round((Date.now() - this.openedAt) / 1000));
    this.store.decideGate(this.run().id, this.gate().id, decision, this.comment().trim() || null, seconds);
    this.comment.set('');
  }
}
