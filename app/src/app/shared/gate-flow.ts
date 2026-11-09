import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import type { Gate, Run } from '../core/domain/run';
import { holdsRole } from '../core/domain/workspace';
import { SaiStore } from '../state/sai-store';
import { ActorBadge, AgoPipe, fileName } from './ui';

type Step = 'notified' | 'review' | 'decide' | 'finalized';

/**
 * The ★ gate as a visible, four-step journey (Clément, 2026-11-09: notification → gate →
 * artifact review → validation → finalization must feel natural at each step). The decision
 * is taken only inside the gate conversation (`mode="decide"`); elsewhere the flow shows where
 * things stand and leads to that conversation. The runtime applies the decision; the UI never
 * writes.
 */
@Component({
  selector: 'sai-gate-flow',
  standalone: true,
  imports: [FormsModule, RouterLink, Button, Textarea, ActorBadge, AgoPipe],
  template: `
    <section class="sai-gate" [class.is-pending]="gate().status === 'pending'" [attr.aria-label]="gate().label">
      <header class="sai-gate-head">
        <span class="sai-gate-star" aria-hidden="true">★</span>
        <div class="min-w-0 flex-1">
          <div class="sai-gate-title">{{ gate().label }}</div>
          <div class="sai-gate-sub">
            {{ fileNameOf(gate().artifactPath) }} from {{ run().workflowInstanceId }}
            @if (gate().status === 'pending') {
              · raised {{ gate().raisedAt | ago }}
            }
          </div>
        </div>
      </header>

      <ol class="sai-steps" aria-label="Gate steps">
        @for (s of steps; track s.key; let i = $index) {
          <li class="sai-step" [class.is-done]="stateOf(s.key) === 'done'" [class.is-current]="stateOf(s.key) === 'current'">
            <span class="sai-step-dot">{{ stateOf(s.key) === 'done' ? '✓' : i + 1 }}</span>
            <span class="sai-step-label">{{ s.label }}</span>
          </li>
        }
      </ol>

      <div class="sai-gate-body">
        @switch (current()) {
          @case ('review') {
            @if (mode() === 'decide') {
              <p class="m-0 text-sm text-ink-muted">Read the artifact before deciding. You can discuss it here with the other reviewers and the agents of the run.</p>
              <div class="sai-actions">
                <p-button label="Open the artifact" icon="pi pi-file" size="small" (onClick)="review.emit(gate().artifactPath); reviewed.set(true)" />
                @if (mayDecide()) {
                  <p-button label="Go to the decision" size="small" [text]="true" severity="secondary" (onClick)="reviewed.set(true)" />
                }
              </div>
            } @else {
              <p class="m-0 text-sm text-ink-muted">
                @if (mayDecide()) {
                  This gate waits for your decision; it is taken in the gate conversation.
                } @else {
                  Waiting for the holders of <code>{{ gate().holderRole }}</code>; the decision is taken in the gate conversation.
                }
              </p>
              <div class="sai-actions">
                @if (conversationId(); as id) {
                  <p-button [label]="mayDecide() ? 'Decide in the gate conversation' : 'Open the gate conversation'" icon="pi pi-comments" size="small" [outlined]="!mayDecide()" [severity]="mayDecide() ? 'primary' : 'secondary'" [routerLink]="['/conversation', id]" />
                }
                <p-button label="Open the artifact" icon="pi pi-file" size="small" [text]="true" severity="secondary" (onClick)="review.emit(gate().artifactPath)" />
              </div>
            }
          }
          @case ('decide') {
            @if (mayDecide()) {
              <label class="text-xs text-ink-muted" for="c-{{ gate().id }}">Comment, required to reject or to approve with a reservation</label>
              <textarea pTextarea class="w-full" id="c-{{ gate().id }}" rows="2" [ngModel]="comment()" (ngModelChange)="comment.set($event)" placeholder="What should change, or what reservation do you record?"></textarea>
              <div class="sai-actions">
                <p-button label="Approve" icon="pi pi-check" size="small" (onClick)="decide('approved')" />
                <p-button label="Approve with reservation" icon="pi pi-flag" size="small" severity="secondary" [outlined]="true" [disabled]="!comment().trim()" (onClick)="decide('approved-with-reservation')" />
                <p-button label="Reject" icon="pi pi-times" size="small" severity="danger" [outlined]="true" [disabled]="!comment().trim()" (onClick)="decide('rejected')" />
                <p-button label="Back to the artifact" size="small" [text]="true" severity="secondary" (onClick)="review.emit(gate().artifactPath)" />
              </div>
            } @else {
              <p class="m-0 text-sm text-ink-light">You do not hold <code>{{ gate().holderRole }}</code>: its holders decide here; you can discuss.</p>
            }
          }
          @case ('finalized') {
            <div class="flex flex-wrap items-center gap-2 text-sm">
              @if (gate().decidedBy; as by) {
                <span class="text-ink-muted">Decided by</span> <sai-actor [actor]="by" />
              }
              <span class="text-ink-light">{{ gate().decidedAt | ago }}</span>
              @if (gate().comment) {
                <span class="text-ink-muted">“{{ gate().comment }}”</span>
              }
            </div>
            <p class="m-0 text-sm text-ink-muted">
              @switch (gate().status) {
                @case ('rejected') {
                  Rejected: the run reworks the artifact and raises a new gate.
                }
                @case ('approved-with-reservation') {
                  Approved with a reservation: the artifact is accepted and the reservation is recorded as a pain point.
                }
                @default {
                  Approved: the artifact is accepted and the run resumes or ends.
                }
              }
            </p>
            <div class="sai-actions">
              <p-button label="Open the artifact" icon="pi pi-file" size="small" [outlined]="true" severity="secondary" (onClick)="review.emit(gate().artifactPath)" />
              <p-button label="Open the run" icon="pi pi-play" size="small" [text]="true" severity="secondary" [routerLink]="['/supervision', 'runs', run().id]" />
              @if (mode() !== 'decide' && conversationId(); as id) {
                <p-button label="Gate conversation" icon="pi pi-comments" size="small" [text]="true" severity="secondary" [routerLink]="['/conversation', id]" />
              }
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class GateFlow {
  private readonly store = inject(SaiStore);
  readonly run = input.required<Run>();
  readonly gate = input.required<Gate>();
  /** `decide` only inside the gate conversation; `link` everywhere else. */
  readonly mode = input<'decide' | 'link'>('link');
  /** Asks the host page to open the artifact in the viewer. */
  readonly review = output<string>();

  readonly steps: readonly { key: Step; label: string }[] = [
    { key: 'notified', label: 'Gate raised' },
    { key: 'review', label: 'Review the artifact' },
    { key: 'decide', label: 'Decide' },
    { key: 'finalized', label: 'Finalized' },
  ];
  readonly comment = signal('');
  readonly reviewed = signal(false);
  private readonly openedAt = Date.now();

  readonly mayDecide = computed(() => holdsRole(this.store.tenant(), this.store.session().userId, this.gate().holderRole));
  readonly conversationId = computed(() => this.store.validationConversationFor(this.gate().id)?.id ?? null);
  readonly current = computed((): Step => {
    if (this.gate().status !== 'pending') return 'finalized';
    if (this.mode() === 'decide' && this.mayDecide() && this.reviewed()) return 'decide';
    return 'review';
  });

  stateOf(step: Step): 'done' | 'current' | 'todo' {
    const order: Step[] = ['notified', 'review', 'decide', 'finalized'];
    const now = order.indexOf(this.current());
    const mine = order.indexOf(step);
    if (step === 'finalized' && this.current() === 'finalized') return 'done';
    return mine < now ? 'done' : mine === now ? 'current' : 'todo';
  }
  fileNameOf(path: string): string {
    return fileName(path);
  }
  decide(decision: 'approved' | 'approved-with-reservation' | 'rejected'): void {
    const seconds = Math.max(1, Math.round((Date.now() - this.openedAt) / 1000));
    this.store.decideGate(this.run().id, this.gate().id, decision, this.comment().trim() || null, seconds);
    this.comment.set('');
  }
}
