import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import type { Gate, Run } from '../core/domain/run';
import { holdsRole } from '../core/domain/workspace';
import { SaiStore } from '../state/sai-store';
import { ActorBadge, StatusBadge, fileName } from './ui';

/**
 * The human ★ gate (F4-R3): review the artifact, then approve, approve with a reservation or
 * reject with a comment. Only a holder of the organization-declared role sees the actions;
 * everyone sees the state. The decision goes through the runtime and becomes a validated
 * workspace commit; the UI never writes. The same card appears in the validation conversation
 * the gate opened, in Supervisor, on the board card and in the run detail.
 */
@Component({
  selector: 'sai-gate-card',
  standalone: true,
  imports: [FormsModule, RouterLink, Button, Textarea, StatusBadge, ActorBadge],
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
        </div>
        <span class="text-xs text-ink-light"
          >holder role <code>{{ gate().holderRole }}</code></span
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
        @if (conversationLink() && conversationId(); as id) {
          <a class="ml-1" [routerLink]="['/conversations', id]"
            ><i class="pi pi-comments text-[0.8em]"></i> Open the validation conversation</a
          >
        }
      </p>

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
            >; the decision belongs to its holders.
          </p>
        }
      } @else {
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
        </div>
      }
    </section>
  `,
})
export class GateCard {
  private readonly store = inject(SaiStore);
  readonly run = input.required<Run>();
  readonly gate = input.required<Gate>();
  /** Show the link to the validation conversation (hidden when the card already sits in it). */
  readonly conversationLink = input(true);
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
