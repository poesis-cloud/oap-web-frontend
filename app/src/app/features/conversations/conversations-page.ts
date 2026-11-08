import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Tag } from 'primeng/tag';
import { Textarea } from 'primeng/textarea';
import type { Conversation } from '../../core/domain/conversation';
import { AgoPipe, StatusBadge, fileName } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

const SCENARIO_INTENT = 'Design a secure REST API for customer subscriptions.';
type Filter = 'all' | 'work' | 'validation';

/** Conversations (F1, F17): work conversations about artifacts and ★ validation conversations opened by gates. */
@Component({
  selector: 'sai-conversations-page',
  standalone: true,
  imports: [FormsModule, RouterLink, Button, InputText, Tag, Textarea, StatusBadge, AgoPipe],
  template: `
    <div class="px-6 py-5 max-md:px-4">
      <header class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl">Conversations</h1>
          <p class="m-0 text-sm text-ink-muted">
            Humans and agents building the artifacts of {{ store.workspace().name }}. ★ gates open validation
            conversations here.
          </p>
        </div>
      </header>

      <section class="sai-card mb-6 flex max-w-3xl flex-col gap-2 p-4">
        <h2 class="text-base">New conversation</h2>
        <p class="m-0 text-sm text-ink-muted">
          State an IT concern. Copilot dispatches it to the right orchestrator or specialist; a workflow starts only
          once you confirm its launch proposal. There is no free chat.
        </p>
        <label class="text-xs text-ink-muted" for="nc-title">Title (optional)</label>
        <input
          pInputText
          id="nc-title"
          [ngModel]="title()"
          (ngModelChange)="title.set($event)"
          placeholder="Subscriptions API"
        />
        <label class="text-xs text-ink-muted" for="nc-intent">Your intent</label>
        <textarea
          pTextarea
          id="nc-intent"
          rows="3"
          [ngModel]="intent()"
          (ngModelChange)="intent.set($event)"
          [placeholder]="scenario"
          (keydown.meta.enter)="create()"
          (keydown.control.enter)="create()"
        ></textarea>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap gap-3 text-xs text-ink-light">
            <span><code>&#64;agent</code> addresses an agent</span>
            <span><code>/workflow</code> addresses its orchestrator</span>
          </div>
          <div class="flex gap-2">
            <p-button
              label="Use the scenario"
              size="small"
              [outlined]="true"
              severity="secondary"
              (onClick)="intent.set(scenario); title.set('Subscriptions API')"
            />
            <p-button label="Start" size="small" icon="pi pi-send" [disabled]="!intent().trim()" (onClick)="create()" />
          </div>
        </div>
      </section>

      <section>
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex gap-1" role="tablist" aria-label="Filter">
            @for (f of filters; track f.value) {
              <p-button
                [label]="f.label + ' ' + countOf(f.value)"
                size="small"
                [outlined]="filter() !== f.value"
                role="tab"
                [attr.aria-selected]="filter() === f.value"
                (onClick)="filter.set(f.value)"
              />
            }
          </div>
          <input
            pInputText
            type="search"
            class="w-60"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            placeholder="Search by title"
            aria-label="Search conversations"
          />
        </div>
        @if (filtered().length === 0) {
          <div class="sai-empty">No conversation here yet.</div>
        } @else {
          <div class="sai-card divide-y divide-line">
            @for (c of filtered(); track c.id) {
              <a
                class="flex flex-col gap-0.5 px-4 py-3 text-ink hover:bg-surface-sunken hover:no-underline"
                [routerLink]="['/conversations', c.id]"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    @if (c.kind === 'validation') {
                      <span class="text-gate" aria-label="validation">★</span>
                    }
                    <strong>{{ c.title }}</strong>
                    @if (c.subject && c.kind !== 'validation') {
                      <p-tag [value]="fileName(c.subject)" severity="secondary" [rounded]="true" />
                    }
                  </div>
                  <div class="flex items-center gap-2 text-xs text-ink-light">
                    <sai-status [status]="c.status" />
                    <span>{{ c.createdAt | ago }}</span>
                  </div>
                </div>
                <div class="truncate text-sm text-ink-muted">{{ last(c) }}</div>
                <div class="text-[11px] text-ink-light">
                  {{ humans(c) }} human{{ humans(c) === 1 ? '' : 's' }} · {{ agents(c) }} agent{{
                    agents(c) === 1 ? '' : 's'
                  }}
                  · {{ c.messages.length }} messages
                  @if (c.proposals.length) {
                    · {{ c.proposals.length }} launch proposal{{ c.proposals.length === 1 ? '' : 's' }}
                  }
                </div>
              </a>
            }
          </div>
        }
      </section>
    </div>
  `,
})
export class ConversationsPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly scenario = SCENARIO_INTENT;
  readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'work', label: 'Work' },
    { value: 'validation', label: '★ Validation' },
  ];
  readonly title = signal('');
  readonly intent = signal('');
  readonly query = signal('');
  readonly filter = signal<Filter>('all');
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return this.store
      .conversations()
      .filter((c) => (f === 'all' || c.kind === f) && (!q || c.title.toLowerCase().includes(q)));
  });

  countOf(filter: Filter): number {
    return this.store.conversations().filter((c) => filter === 'all' || c.kind === filter).length;
  }

  create(): void {
    const intent = this.intent().trim();
    if (!intent) return;
    const title = this.title().trim() || intent.slice(0, 48);
    const conversation = this.store.startConversation(title, intent);
    if (conversation) {
      this.title.set('');
      this.intent.set('');
      void this.router.navigate(['/conversations', conversation.id]);
    }
  }

  fileName(path: string): string {
    return fileName(path);
  }
  last(c: Conversation): string {
    return c.messages.at(-1)?.content ?? '';
  }
  humans(c: Conversation): number {
    return c.participants.filter((p) => p.status === 'joined' && p.actor.kind === 'human').length;
  }
  agents(c: Conversation): number {
    return c.participants.filter((p) => p.status === 'joined' && p.actor.kind === 'agent').length;
  }
}
