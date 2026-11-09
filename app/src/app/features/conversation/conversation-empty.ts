import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';

@Component({
  selector: 'sai-conversation-empty',
  host: { class: 'flex h-full min-h-0 flex-col' },
  standalone: true,
  imports: [RouterLink, Button],
  template: `
    <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <i class="pi pi-comments text-3xl text-ink-light" aria-hidden="true"></i>
      <p class="m-0 text-sm text-ink-muted">Pick a conversation, or start one to state what you need. Agents of the organization take part; a ★ gate opens its own conversation when a decision is needed.</p>
      <p-button label="New conversation" icon="pi pi-plus" size="small" routerLink="/conversation/new" />
    </div>
  `,
})
export class ConversationEmpty {}
