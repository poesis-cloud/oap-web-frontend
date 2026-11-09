import { Component, computed, HostListener, inject, signal } from '@angular/core';
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

interface MenuEntry {
  readonly key: string;
  readonly path: string;
  readonly label: string;
  /** Short label for the phone bar. */
  readonly short?: string;
  readonly icon: string;
  readonly children?: readonly { readonly path: string; readonly label: string }[];
}

/** Below this width the side menu is a rail (tablet) or a bottom bar (phone): groups open a sections sheet. */
const COMPACT_QUERY = '(max-width: 1023px)';

const SECTION_LABELS: Record<string, string> = {
  workspace: 'Workspace',
  organizations: 'Agentic Organizations',
  conversation: 'Conversation',
  supervision: 'Supervision',
};
const SUB_LABELS: Record<string, string> = {
  explorer: 'Explorer',
  board: 'Board',
  improvement: 'Improvement',
  organizations: 'Agentic Organizations',
  gates: 'Gates',
  runs: 'Runs',
  organization: 'Organization',
  new: 'New',
};

/**
 * Application frame (Clément, 2026-11-08/09: a real desktop-like application, not pages):
 * side menu with collapsible groups, a thin title bar with breadcrumbs and notifications,
 * the feature panes filling the rest. The acting-as switch and the run scheduler controls
 * live in the user menu; the demo nature of the backends is a discreet chip.
 */
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

  readonly menu: readonly MenuEntry[] = [
    {
      key: 'workspace',
      path: '/workspace/explorer',
      label: 'Workspace',
      icon: 'pi pi-folder',
      children: [
        { path: '/workspace/explorer', label: 'Explorer' },
        { path: '/workspace/board', label: 'Board' },
        { path: '/workspace/improvement', label: 'Improvement' },
      ],
    },
    {
      key: 'organizations',
      path: '/organizations',
      label: 'Agentic Organizations',
      short: 'Organizations',
      icon: 'pi pi-sitemap',
    },
    { key: 'conversation', path: '/conversation', label: 'Conversation', icon: 'pi pi-comments' },
    {
      key: 'supervision',
      path: '/supervision/gates',
      label: 'Supervision',
      icon: 'pi pi-shield',
      children: [
        { path: '/supervision/gates', label: 'Gates' },
        { path: '/supervision/runs', label: 'Runs' },
        { path: '/supervision/organization', label: 'Organization' },
      ],
    },
  ];
  /** Groups the user folded or unfolded by hand; the active group is always open. */
  readonly toggled = signal<Record<string, boolean>>({});
  /** Tablet rail or phone bar (Clément, 2026-11-09: every section must stay reachable on small screens). */
  readonly compact = signal(
    typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(COMPACT_QUERY).matches : false,
  );
  /** The group whose sections sheet is open (bottom sheet on a phone, flyout beside the rail or under the crumbs). */
  readonly sheet = signal<string | null>(null);
  readonly sheetEntry = computed(() => this.menu.find((m) => m.key === this.sheet() && m.children) ?? null);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  readonly segments = computed(() => this.currentUrl().split('?')[0].split('/').filter(Boolean));
  readonly section = computed(() => SECTION_LABELS[this.segments()[0] ?? ''] ?? 'Supervision');
  readonly subsection = computed(() => SUB_LABELS[this.segments()[1] ?? ''] ?? '');
  readonly sectionPath = computed(
    () => this.menu.find((m) => m.key === this.segments()[0])?.path ?? '/supervision/gates',
  );
  readonly sectionEntry = computed(() => this.menu.find((m) => m.key === this.segments()[0]) ?? null);
  readonly workspaceOptions = computed(() => [...this.store.workspaces()]);
  readonly memberOptions = computed(() => [...this.store.tenant().members]);
  readonly unread = computed(() => this.store.notifications().filter((n) => n.readAt === null));
  readonly recent = computed(() => this.store.notifications().slice(0, 12));
  readonly initials = computed(() => initialsOf(this.store.me()?.displayName ?? '?'));
  readonly roleLine = computed(() => {
    const me = this.store.me();
    if (!me) return '';
    return me.roles.length ? me.roles.map((r) => r.replace(/-/g, ' ')).join(', ') : me.permission;
  });

  isOpen(entry: MenuEntry): boolean {
    const forced = this.toggled()[entry.key];
    if (forced !== undefined) return forced;
    return this.segments()[0] === entry.key;
  }
  toggle(entry: MenuEntry, event: Event): void {
    event.preventDefault();
    if (this.compact()) {
      this.openSheet(entry);
      return;
    }
    const open = this.isOpen(entry);
    this.toggled.update((t) => ({ ...t, [entry.key]: !open }));
    if (!open && this.segments()[0] !== entry.key) void this.router.navigateByUrl(entry.path);
  }
  isActiveGroup(entry: MenuEntry): boolean {
    return this.segments()[0] === entry.key;
  }
  /** A group opens its sections sheet; a single surface navigates. Tapping the open group's entry again closes it. */
  openSheet(entry: MenuEntry): void {
    if (!entry.children) {
      this.sheet.set(null);
      void this.router.navigateByUrl(entry.path);
      return;
    }
    this.sheet.set(this.sheet() === entry.key ? null : entry.key);
  }
  /** The crumbs are navigation too: the section opens its sheet, or goes to its only surface. */
  openSectionSheet(event: Event): void {
    const entry = this.sectionEntry();
    if (!entry) return;
    event.preventDefault();
    this.openSheet(entry);
  }
  closeSheet(): void {
    this.sheet.set(null);
  }
  @HostListener('window:resize')
  onResize(): void {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const compact = window.matchMedia(COMPACT_QUERY).matches;
    if (compact !== this.compact()) {
      this.compact.set(compact);
      this.sheet.set(null);
    }
  }
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.sheet.set(null);
  }

  /** Starts the demonstration conversation: intent → proposal → launch → gate. */
  runScenario(): void {
    const conversation = this.store.runScenario();
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }

  switchWorkspace(id: string): void {
    this.store.workspaceId.set(id);
    void this.router.navigate(['/workspace/explorer']);
  }

  open(notification: Notification, popover: Popover): void {
    if (notification.readAt === null) this.store.markNotificationRead(notification.id);
    popover.hide();
    this.store.workspaceId.set(notification.workspaceId);
    const refs = notification.refs;
    if (refs.conversationId) void this.router.navigate(['/conversation', refs.conversationId]);
    else if (refs.runId) void this.router.navigate(['/supervision', 'runs', refs.runId]);
    else if (refs.artifactPath)
      void this.router.navigate(['/workspace', 'explorer'], { queryParams: { file: refs.artifactPath } });
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

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
