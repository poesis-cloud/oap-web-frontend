import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputText } from 'primeng/inputtext';
import { map } from 'rxjs';
import type { Artifact, WorkItem } from '../../core/domain/artifact';
import { pendingGate, type Run } from '../../core/domain/run';
import { fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { SaiStore } from '../../state/sai-store';

/** Workspace › Board (F5-R2): work items by the statuses the organization declares; a card opens the viewer. */
@Component({
  selector: 'sai-board-page',
  standalone: true,
  imports: [FormsModule, InputText, Viewer],
  templateUrl: './board-page.html',
})
export class BoardPage {
  readonly store = inject(SaiStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly file = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('file'))), { initialValue: null as string | null });
  readonly query = signal('');
  readonly itemType = signal('feature');
  readonly presentTypes = computed(() => {
    const present = new Set(this.store.workItems().map((i) => i.type));
    return this.store.organization().itemTypes.filter((t) => t.slug === 'feature' || present.has(t.slug));
  });
  readonly statuses = computed(() => this.store.organization().itemTypes.find((t) => t.slug === this.itemType())?.statuses ?? []);
  readonly filteredItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.store.workItems().filter((i) => i.type === this.itemType() && (!q || i.title.toLowerCase().includes(q)));
  });
  readonly artifact = computed((): Artifact | null => {
    const path = this.file();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });

  itemsIn(status: string): WorkItem[] {
    return this.filteredItems().filter((i) => i.status === status);
  }
  countOf(type: string): number {
    return this.store.workItems().filter((i) => i.type === type).length;
  }
  gateWaiting(item: WorkItem): boolean {
    return this.store.runs().some((r: Run) => item.runIds.includes(r.id) && pendingGate(r) !== undefined);
  }
  open(item: WorkItem): void {
    void this.router.navigate(['/workspace', 'board'], { queryParams: { file: item.path } });
  }
  close(): void {
    void this.router.navigate(['/workspace', 'board']);
  }
  discuss(path: string): void {
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
