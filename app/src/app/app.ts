import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Button } from 'primeng/button';
import { Popover } from 'primeng/popover';
import { Select } from 'primeng/select';
import { Toast } from 'primeng/toast';
import { Tooltip } from 'primeng/tooltip';
import { filter, map, startWith } from 'rxjs';
import { ThemeService } from './core/theme/theme.service';
import type { Notification } from './core/domain/notification';
import { AgoPipe } from './shared/ui';
import { SaiStore } from './state/sai-store';

const SECTION_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  conversations: 'Conversations',
  supervisor: 'Supervisor',
};

/** Application shell: sidebar with the three surfaces, header with notifications, mock controls. */
@Component({
  selector: 'sai-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, Button, Popover, Select, Toast, Tooltip, AgoPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(SaiStore);
  readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  readonly menu = [
    { path: '/workspace', label: 'Workspace', icon: 'pi pi-folder-open' },
    { path: '/conversations', label: 'Conversations', icon: 'pi pi-comments' },
    { path: '/supervisor', label: 'Supervisor', icon: 'pi pi-eye' },
  ] as const;

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  readonly section = computed(() => {
    const first = this.currentUrl().split('?')[0].split('/').filter(Boolean)[0] ?? 'supervisor';
    return SECTION_LABELS[first] ?? first;
  });
  /** PrimeNG Select wants mutable arrays. */
  readonly workspaceOptions = computed(() => [...this.store.workspaces()]);
  readonly memberOptions = computed(() => [...this.store.tenant().members]);
  readonly unread = computed(() => this.store.notifications().filter((n) => n.readAt === null));
  readonly recent = computed(() => this.store.notifications().slice(0, 12));

  open(notification: Notification, popover: Popover): void {
    if (notification.readAt === null) this.store.markNotificationRead(notification.id);
    popover.hide();
    const refs = notification.refs;
    if (refs.conversationId) void this.router.navigate(['/conversations', refs.conversationId]);
    else if (refs.runId) void this.router.navigate(['/supervisor', 'runs', refs.runId]);
    else if (refs.artifactPath) void this.router.navigate(['/workspace'], { queryParams: { path: refs.artifactPath } });
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
