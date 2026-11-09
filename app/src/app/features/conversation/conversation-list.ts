import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Tooltip } from 'primeng/tooltip';
import type { Conversation } from '../../core/domain/conversation';
import { AgoPipe, actorLabel, fileName } from '../../shared/ui';
import { initialsOf } from '../../app';
import { SaiStore } from '../../state/sai-store';

type Filter = 'all' | 'work' | 'validation';

@Component({
  selector: 'sai-conversation-list',
  standalone: true,
  imports: [FormsModule, RouterLink, RouterLinkActive, Button, InputText, Tooltip, AgoPipe],
  host: { class: 'pane is-list' },
  template: `
    <div class="pane-bar">
      <span class="pane-title">Conversation</span>
      <span class="pane-spacer"></span>
      <p-button icon="pi pi-search" [text]="true" [rounded]="true" severity="secondary" ariaLabel="Search" pTooltip="Search" tooltipPosition="bottom" [class.is-on]="searching()" (onClick)="searching.set(!searching())" />
      <p-button icon="pi pi-plus" [rounded]="true" size="small" ariaLabel="New conversation" pTooltip="New conversation" tooltipPosition="bottom" routerLink="/conversation/new" />
    </div>
    @if (searching()) {
      <div class="border-b border-line px-3 py-2">
        <input pInputText type="search" size="small" class="w-full" [ngModel]="query()" (ngModelChange)="query.set($event)" placeholder="Search by title" aria-label="Search conversations" />
      </div>
    }
    <div class="border-b border-line px-3 py-2">
      <div class="sai-segment" role="tablist" aria-label="Filter">
        @for (f of filters; track f.value) {
          <button type="button" role="tab" [class.is-on]="filter() === f.value" [attr.aria-selected]="filter() === f.value" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>
    </div>
    <div class="pane-body">
      @for (c of filtered(); track c.id) {
        <a class="sai-item" [routerLink]="['/conversation', c.id]" routerLinkActive="is-on">
          @if (c.kind === 'validation') {
            <span class="relative grid h-9 w-9 flex-none place-items-center rounded-full bg-gate-tint text-gate" aria-label="gate">★
              @if (waitsForMe(c)) {
                <span class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gate sai-pulse" aria-label="waits for your decision"></span>
              }
            </span>
          } @else {
            <span class="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary-tint text-[11px] font-bold text-primary-tint-text">{{ initials(c) }}</span>
          }
          <span class="sai-item-main">
            <span class="flex items-baseline justify-between gap-2">
              <span class="sai-item-title">{{ plainTitle(c) }}</span>
              <span class="sai-item-meta">{{ lastAt(c) | ago }}</span>
            </span>
            <span class="sai-item-sub">
              @if (c.status === 'closed') {
                <span class="text-ok">decided</span> ·
              } @else if (c.status === 'archived') {
                archived ·
              }
              {{ last(c) }}
            </span>
          </span>
        </a>
      }
      @if (filtered().length === 0) {
        <div class="p-8 text-center text-sm text-ink-muted">No conversation yet. Start one to state what you need.</div>
      }
    </div>
  `,
})
export class ConversationList {
  readonly store = inject(SaiStore);
  readonly filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'work', label: 'Work' },
    { value: 'validation', label: '★ Gates' },
  ];
  readonly filter = signal<Filter>('all');
  readonly query = signal('');
  readonly searching = signal(false);
  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const f = this.filter();
    return [...this.store.conversations()]
      .filter((c) => (f === 'all' || c.kind === f) && (!q || c.title.toLowerCase().includes(q)))
      .sort((a, b) => this.lastAt(b).localeCompare(this.lastAt(a)));
  });

  plainTitle(c: Conversation): string {
    return c.title.replace(/^★\s*/, '');
  }
  /** A gate conversation whose gate is pending and which the current user may decide. */
  waitsForMe(c: Conversation): boolean {
    return c.kind === 'validation' && c.status === 'open' && this.store.gatesWaitingForMe().some((w) => w.gate.id === c.gateRef?.gateId);
  }
  last(c: Conversation): string {
    const m = c.messages.at(-1);
    if (!m) return c.subject ? `About ${fileName(c.subject)}` : 'No message yet';
    return `${actorLabel(m.author, this.store.tenant().members)}: ${m.content}`;
  }
  lastAt(c: Conversation): string {
    return c.messages.at(-1)?.createdAt ?? c.createdAt;
  }
  initials(c: Conversation): string {
    const human = c.participants.find((p) => p.actor.kind === 'human' && p.status === 'joined');
    return initialsOf(human ? actorLabel(human.actor, this.store.tenant().members) : c.title);
  }
}
