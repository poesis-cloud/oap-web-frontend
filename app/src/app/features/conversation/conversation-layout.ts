import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { ConversationList } from './conversation-list';

/** Conversation (Clément, 2026-11-08: like Teams): the list right of the menu, the thread next to it. */
@Component({
  selector: 'sai-conversation-layout',
  standalone: true,
  imports: [RouterOutlet, ConversationList],
  template: `
    <div class="panes is-wide-list" [class.show-list]="listOnly()">
      <sai-conversation-list class="pane is-list" />
      <section class="pane is-content is-canvas" aria-label="Conversation">
        <router-outlet />
      </section>
    </div>
  `,
})
export class ConversationLayout {
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  /** On a phone the list shows alone until a thread is chosen. */
  readonly listOnly = computed(() => this.url().split('?')[0] === '/conversation');
}
