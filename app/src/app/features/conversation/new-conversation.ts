import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { SaiStore } from '../../state/sai-store';

const SCENARIO_INTENT = 'Design a secure REST API for customer subscriptions.';

/** New conversation: a compose area, like a chat application's new thread. */
@Component({
  selector: 'sai-new-conversation',
  host: { class: 'flex h-full min-h-0 flex-col' },
  standalone: true,
  imports: [FormsModule, Button, InputText, Textarea],
  template: `
    <div class="pane-bar bg-surface"><span class="pane-title">New conversation</span></div>
    <div class="pane-body">
      <div class="mx-auto flex max-w-2xl flex-col gap-3 p-6">
        <input pInputText id="nc-title" class="w-full" [ngModel]="title()" (ngModelChange)="title.set($event)" placeholder="Title (optional)" aria-label="Title" />
        <textarea pTextarea id="nc-intent" rows="4" class="w-full" [ngModel]="intent()" (ngModelChange)="intent.set($event)" placeholder="What do you need? Copilot routes it to the right orchestrator or specialist; a workflow starts only once you confirm its launch proposal." aria-label="Your intent" (keydown.meta.enter)="create()" (keydown.control.enter)="create()"></textarea>
        <div class="flex flex-wrap items-center gap-2">
          @for (a of quickAgents; track a) {
            <button type="button" class="sai-chip" (click)="insert('@' + a + ' ')">&#64;{{ a }}</button>
          }
          <button type="button" class="sai-chip" (click)="insert('/architectural-runway-extension ')">/architectural-runway-extension</button>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p-button label="Use the scenario" size="small" [text]="true" severity="secondary" (onClick)="intent.set(scenario); title.set('Subscriptions API')" />
          <p-button label="Start" icon="pi pi-send" size="small" [disabled]="!intent().trim()" (onClick)="create()" />
        </div>
      </div>
    </div>
  `,
})
export class NewConversation {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly scenario = SCENARIO_INTENT;
  readonly quickAgents = ['system-architect', 'security-expert', 'developer', 'release-train-engineer'];
  readonly title = signal('');
  readonly intent = signal('');

  insert(text: string): void {
    this.intent.update((d) => (d.endsWith(' ') || d === '' ? d + text : `${d} ${text}`));
  }
  create(): void {
    const intent = this.intent().trim();
    if (!intent) return;
    const title = this.title().trim() || intent.slice(0, 48);
    const conversation = this.store.startConversation(title, intent);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
