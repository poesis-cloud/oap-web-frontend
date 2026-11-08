import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PrimeTemplate, type TreeNode } from 'primeng/api';
import { Button } from 'primeng/button';
import { Drawer } from 'primeng/drawer';
import { InputText } from 'primeng/inputtext';
import { Tab, TabList, Tabs } from 'primeng/tabs';
import { Tag } from 'primeng/tag';
import { Tree } from 'primeng/tree';
import { map } from 'rxjs';
import { countFiles, type TreeEntry } from '../../core/application/workspace-tree';
import { artifactFormat, type Artifact, type WorkItem } from '../../core/domain/artifact';
import { itemTypeForPath } from '../../core/domain/organization';
import { pendingGate, type Run } from '../../core/domain/run';
import { ArtifactViewer } from '../../shared/artifact-viewer';
import { GateCard } from '../../shared/gate-card';
import { StatusBadge, TitlePipe, fileName } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

type View = 'explorer' | 'board';

/**
 * Workspace (F5): a workspace is one hosted SAF git repository (its organization and its
 * artifacts). The explorer lays the artifacts out as the organization's workspace structure
 * map, every artifact previewed read-only in its native format (F5-R7, F5-R9); the board shows
 * the work items by declared statuses (F5-R2). The organization folder has its own surface
 * (Organization). All views read the hosted workspace; decisions happen at gates.
 */
@Component({
  selector: 'sai-workspace-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PrimeTemplate,
    Button,
    Drawer,
    InputText,
    Tabs,
    TabList,
    Tab,
    Tag,
    Tree,
    ArtifactViewer,
    GateCard,
    StatusBadge,
    TitlePipe,
  ],
  templateUrl: './workspace-page.html',
})
export class WorkspacePage {
  readonly store = inject(SaiStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly view = input<View | string>('explorer');
  readonly selectedPath = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('path'))), {
    initialValue: null as string | null,
  });

  // Explorer
  readonly treeNodes = computed(() => this.store.tree().map((e) => this.toNode(e, 0)));
  readonly treeSelection = signal<TreeNode | null>(null);
  readonly counts = computed(() => countFiles(this.store.tree()));
  readonly selected = computed((): Artifact | null => {
    const path = this.selectedPath();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });
  readonly selectedKind = computed(() =>
    this.selectedPath() ? (itemTypeForPath(this.store.organization(), this.selectedPath()!)?.slug ?? null) : null,
  );

  // Board
  readonly query = signal('');
  readonly itemType = signal('feature');
  readonly drawerItem = signal<WorkItem | null>(null);
  readonly drawerOpen = signal(false);
  readonly presentTypes = computed(() => {
    const present = new Set(this.store.workItems().map((i) => i.type));
    return this.store.organization().itemTypes.filter((t) => t.slug === 'feature' || present.has(t.slug));
  });
  readonly statuses = computed(
    () => this.store.organization().itemTypes.find((t) => t.slug === this.itemType())?.statuses ?? [],
  );
  readonly filteredItems = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.store
      .workItems()
      .filter((i) => i.type === this.itemType() && (!q || i.title.toLowerCase().includes(q)));
  });

  constructor() {
    // Keep the tree selection in sync with the route (deep links, back/forward).
    effect(() => {
      const path = this.selectedPath();
      this.treeSelection.set(path ? (this.findNode(this.treeNodes(), path) ?? null) : null);
    });
  }

  // ---- explorer

  private toNode(entry: TreeEntry, depth: number): TreeNode<TreeEntry> {
    if (entry.kind === 'folder') {
      return {
        key: entry.path || entry.name,
        label: entry.name,
        data: entry,
        icon: entry.expected ? 'pi pi-folder text-ink-light' : 'pi pi-folder text-gate',
        // The map is the point of the explorer: mapped folders open by default, unmapped ones stay folded.
        expanded:
          entry.name !== 'Unmapped' &&
          (entry.description !== '' || depth < 2 || (this.selectedPath()?.startsWith(`${entry.path}/`) ?? false)),
        selectable: false,
        styleClass: entry.expected ? 'sai-node-expected' : undefined,
        children: entry.children.map((c) => this.toNode(c, depth + 1)),
        leaf: entry.children.length === 0,
      };
    }
    const format = artifactFormat(entry.path);
    return {
      key: entry.path,
      label: entry.name,
      data: entry,
      icon: entry.expected
        ? 'pi pi-file text-ink-light'
        : format === 'markdown'
          ? 'pi pi-file-edit text-primary'
          : format === 'text'
            ? 'pi pi-file'
            : 'pi pi-code text-ai',
      leaf: true,
      selectable: !entry.expected,
      styleClass: entry.expected ? 'sai-node-expected' : undefined,
    };
  }

  private findNode(nodes: readonly TreeNode[], path: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.key === path) return node;
      const hit = node.children ? this.findNode(node.children, path) : undefined;
      if (hit) return hit;
    }
    return undefined;
  }

  onSelect(event: { node: TreeNode }): void {
    const entry = event.node.data as TreeEntry | undefined;
    if (!entry || entry.kind !== 'file' || entry.expected) return;
    void this.router.navigate(['/workspace'], { queryParams: { path: entry.path } });
  }

  discuss(path: string): void {
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversations', conversation.id]);
  }

  // ---- board

  itemsIn(status: string): WorkItem[] {
    return this.filteredItems().filter((i) => i.status === status);
  }
  countOf(type: string): number {
    return this.store.workItems().filter((i) => i.type === type).length;
  }
  runsFor(item: WorkItem): Run[] {
    return this.store.runs().filter((r) => item.runIds.includes(r.id));
  }
  gateFor(item: WorkItem): { run: Run; gate: NonNullable<ReturnType<typeof pendingGate>> } | null {
    for (const run of this.runsFor(item)) {
      const gate = pendingGate(run);
      if (gate) return { run, gate };
    }
    return null;
  }
  folderArtifacts(item: WorkItem): Artifact[] {
    const folder = item.path.slice(0, item.path.lastIndexOf('/'));
    return this.store.artifacts().filter((a) => a.path.startsWith(`${folder}/`));
  }
  openItem(item: WorkItem): void {
    this.drawerItem.set(item);
    this.drawerOpen.set(true);
  }
  fileName(path: string): string {
    return fileName(path);
  }
}
