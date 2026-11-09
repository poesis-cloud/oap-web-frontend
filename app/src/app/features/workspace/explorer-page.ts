import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { PrimeTemplate, type TreeNode } from 'primeng/api';

import { Tooltip } from 'primeng/tooltip';
import { Tree } from 'primeng/tree';
import { map } from 'rxjs';
import { crumbs, fileCount, listDirectory, parentDir } from '../../core/application/explorer';
import { countFiles, type TreeEntry } from '../../core/application/workspace-tree';
import type { Artifact } from '../../core/domain/artifact';
import { itemTypeForPath } from '../../core/domain/organization';
import { FileIcon, iconKindFor } from '../../shared/icons';
import { AgoPipe, fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { SaiStore } from '../../state/sai-store';

/**
 * Workspace › Explorer (Clément, 2026-11-09): the file hierarchy on the left, the current
 * directory in the centre like GitHub; a folder click changes the directory, an artifact
 * click opens the viewer over the listing, which dims behind it. The tree follows the
 * organization's structure map; the organization folder is browsed here like any other.
 */
@Component({
  selector: 'sai-explorer-page',
  standalone: true,
  imports: [PrimeTemplate, Tooltip, Tree, FileIcon, Viewer, AgoPipe],
  templateUrl: './explorer-page.html',
})
export class ExplorerPage {
  readonly store = inject(SaiStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly dir = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('dir') ?? '')), { initialValue: '' });
  readonly file = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('file'))), { initialValue: null as string | null });

  readonly tree = this.store.tree;
  readonly treeNodes = computed(() => this.tree().filter((e) => !e.expected).map((e) => this.toNode(e, 0)));
  readonly treeSelection = signal<TreeNode | null>(null);
  readonly entries = computed(() => listDirectory(this.tree(), this.dir()));
  readonly crumbs = computed(() => crumbs(this.dir()));
  readonly counts = computed(() => countFiles(this.tree()));
  readonly artifact = computed((): Artifact | null => {
    const path = this.file();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });
  readonly parent = computed(() => parentDir(this.dir()));

  constructor() {
    effect(() => {
      const key = this.file() ?? this.dir();
      this.treeSelection.set(key ? (this.findNode(this.treeNodes(), key) ?? null) : null);
    });
  }

  // ---- navigation

  openDir(path: string): void {
    void this.router.navigate(['/workspace', 'explorer'], { queryParams: { dir: path || null } });
  }
  openFile(path: string): void {
    void this.router.navigate(['/workspace', 'explorer'], { queryParams: { dir: parentDir(path) || null, file: path } });
  }
  closeViewer(): void {
    void this.router.navigate(['/workspace', 'explorer'], { queryParams: { dir: this.dir() || null } });
  }
  onSelect(event: { node: TreeNode }): void {
    const entry = event.node.data as TreeEntry | undefined;
    if (!entry) return;
    if (entry.kind === 'folder') this.openDir(entry.path);
    else if (!entry.expected) this.openFile(entry.path);
  }
  discuss(path: string): void {
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }

  // ---- rows

  icon(entry: TreeEntry) {
    return iconKindFor(entry.path, { folder: entry.kind === 'folder', expected: entry.expected });
  }
  kindOf(entry: TreeEntry): string | null {
    if (entry.kind === 'file') return entry.artifact ?? itemTypeForPath(this.store.organization(), entry.path)?.slug ?? null;
    return null;
  }
  changedAt(entry: TreeEntry): string | null {
    if (entry.kind !== 'file' || entry.expected) return null;
    return this.store.artifacts().find((a) => a.path === entry.path)?.head.commit.timestamp ?? null;
  }
  lastMessage(entry: TreeEntry): string | null {
    if (entry.kind !== 'file' || entry.expected) return null;
    return this.store.artifacts().find((a) => a.path === entry.path)?.head.commit.message ?? null;
  }
  files(entry: TreeEntry): number {
    return fileCount(entry);
  }

  // ---- tree

  private toNode(entry: TreeEntry, depth: number): TreeNode<TreeEntry> {
    if (entry.kind === 'folder') {
      return {
        key: entry.path,
        label: entry.name,
        data: entry,
        expanded: depth === 0 || (this.dir() + '/').startsWith(`${entry.path}/`),
        selectable: true,
        styleClass: entry.expected ? 'sai-node-expected' : undefined,
        children: entry.children.filter((c) => !c.expected).map((c) => this.toNode(c, depth + 1)),
        leaf: entry.children.every((c) => c.expected),
      };
    }
    return { key: entry.path, label: entry.name, data: entry, leaf: true, selectable: true };
  }
  private findNode(nodes: readonly TreeNode[], key: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.key === key) return node;
      const hit = node.children ? this.findNode(node.children, key) : undefined;
      if (hit) return hit;
    }
    return undefined;
  }
}
