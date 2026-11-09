import { Component, computed, HostListener, inject, input, output, signal } from '@angular/core';
import { Button } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { toDataNodes, type DataNode } from '../core/application/data-tree';
import { artifactFormat, type Artifact, type ArtifactVersion } from '../core/domain/artifact';
import { parseArtifact } from '../core/saf/frontmatter';
import { parseYaml } from '../core/saf/yaml';
import { SaiStore } from '../state/sai-store';
import { DataTreeView } from './data-tree-view';
import { DiffView } from './diff-view';
import { MarkdownView } from './markdown-view';
import { ActorBadge, ClockPipe, StatusBadge, fileName } from './ui';

type Parsed = { kind: 'tree'; nodes: DataNode[] } | { kind: 'error'; message: string };

/**
 * The generic read-only **viewer** of any workspace object (Clément, 2026-11-08): like an
 * editor in read mode. Title on top, three grouped icon buttons (versions with diff, raw
 * source, discuss) and a close button; the content fills the pane. As an overlay it spans the
 * directory listing, which dims behind it (2026-11-09). Nothing here edits (R15).
 */
@Component({
  selector: 'sai-viewer',
  standalone: true,
  imports: [Button, Tooltip, DataTreeView, DiffView, MarkdownView, ActorBadge, ClockPipe, StatusBadge],
  template: `
    @if (overlay()) {
      <div class="sai-viewer-backdrop" (click)="close.emit()" aria-hidden="true"></div>
    }
    <section class="sai-viewer" [class.is-overlay]="overlay()" role="dialog" [attr.aria-label]="title()">
      <header class="sai-viewer-bar">
        <div class="min-w-0 flex-1">
          <h2 class="sai-viewer-title">{{ title() }}</h2>
          <div class="sai-viewer-path" [title]="artifact().path">{{ artifact().path }}</div>
        </div>
        @if (status(); as s) {
          <sai-status [status]="s" />
        }
        <div class="sai-toolgroup" role="toolbar" aria-label="Viewer actions">
          <p-button
            icon="pi pi-history"
            [text]="true"
            severity="secondary"
            [pTooltip]="'Versions (' + artifact().versions.length + ')'"
            tooltipPosition="bottom"
            ariaLabel="Versions"
            [class.is-on]="panel() === 'versions'"
            (onClick)="togglePanel('versions')"
          />
          <p-button
            icon="pi pi-code"
            [text]="true"
            severity="secondary"
            [pTooltip]="raw() ? 'Rendered view' : 'Raw source'"
            tooltipPosition="bottom"
            ariaLabel="Raw source"
            [class.is-on]="raw()"
            (onClick)="raw.set(!raw())"
          />
          <p-button
            icon="pi pi-comments"
            [text]="true"
            severity="secondary"
            [pTooltip]="conversations().length ? 'Discuss (' + conversations().length + ' open)' : 'Discuss'"
            tooltipPosition="bottom"
            ariaLabel="Discuss"
            (onClick)="discuss.emit(artifact().path)"
          />
        </div>
        @if (overlay()) {
          <p-button icon="pi pi-times" [text]="true" [rounded]="true" severity="secondary" ariaLabel="Close" pTooltip="Close (Esc)" tooltipPosition="bottom" (onClick)="close.emit()" />
        }
      </header>

      <div class="sai-viewer-body">
        @if (panel() === 'versions') {
          <aside class="sai-viewer-side" aria-label="Versions">
            <div class="sai-side-title">Versions</div>
            <ol class="m-0 list-none p-0">
              @for (v of artifact().versions; track v.commit.sha; let i = $index) {
                <li>
                  <button type="button" class="sai-version" [class.is-on]="versionIndex() === i" (click)="versionIndex.set(i)">
                    <span class="flex items-center justify-between gap-2">
                      <strong>v{{ artifact().versions.length - i }}</strong>
                      <span class="text-ink-light">{{ v.commit.timestamp | clock }}</span>
                    </span>
                    <span class="block truncate text-ink-muted">{{ v.commit.message }}</span>
                    <span class="flex items-center gap-2 text-ink-light">
                      <span class="font-mono">{{ v.commit.sha.slice(0, 7) }}</span>
                      @if (v.commit.author.kind === 'agent' || v.commit.author.kind === 'human') {
                        <sai-actor [actor]="$any(v.commit.author)" />
                      } @else {
                        <span>{{ v.commit.author.kind }}</span>
                      }
                    </span>
                  </button>
                </li>
              }
            </ol>
          </aside>
          <div class="sai-viewer-content">
            @if (selectedVersion(); as v) {
              <div class="mb-2 flex items-center justify-between gap-2 text-sm text-ink-muted">
                <span>
                  @if (previousVersion()) {
                    Changes of v{{ artifact().versions.length - versionIndex() }} against the previous version
                  } @else {
                    First version, shown in full
                  }
                </span>
                @if (v.commit.runId) {
                  <span class="font-mono text-xs">{{ v.commit.runId }} · {{ v.commit.stepSlug }}</span>
                }
              </div>
              @if (previousVersion(); as prev) {
                <sai-diff [before]="prev.content" [after]="v.content" />
              } @else {
                <pre class="sai-raw">{{ v.content }}</pre>
              }
            }
          </div>
        } @else if (raw()) {
          <pre class="sai-raw">{{ artifact().head.content }}</pre>
        } @else {
          <div class="sai-viewer-content sai-prose">
            @switch (format()) {
              @case ('markdown') {
                <sai-markdown [source]="parsed().body" />
              }
              @case ('yaml') {
                @if (data().kind === 'tree') {
                  <sai-data-tree [data]="$any(data()).nodes" [expandDepth]="2" />
                } @else {
                  <pre class="sai-raw">{{ artifact().head.content }}</pre>
                }
              }
              @case ('json') {
                @if (data().kind === 'tree') {
                  <sai-data-tree [data]="$any(data()).nodes" [expandDepth]="1" />
                } @else {
                  <pre class="sai-raw">{{ artifact().head.content }}</pre>
                }
              }
              @default {
                <pre class="sai-raw">{{ artifact().head.content }}</pre>
              }
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class Viewer {
  private readonly store = inject(SaiStore);
  readonly artifact = input.required<Artifact>();
  /** Overlay spans the pane behind it (explorer, board); inline fills a pane of its own (runs). */
  readonly overlay = input(true);
  readonly close = output<void>();
  readonly discuss = output<string>();

  readonly raw = signal(false);
  readonly panel = signal<'versions' | null>(null);
  readonly versionIndex = signal(0);

  readonly format = computed(() => artifactFormat(this.artifact().path));
  readonly parsed = computed(() => parseArtifact(this.artifact().head.content));
  readonly title = computed(() => this.parsed().title ?? fileName(this.artifact().path));
  readonly status = computed(() => {
    const s = this.parsed().frontmatter['status'];
    return typeof s === 'string' ? s : null;
  });
  readonly data = computed((): Parsed => {
    const content = this.artifact().head.content;
    try {
      const value = this.format() === 'json' ? (JSON.parse(content) as unknown) : parseYaml(content);
      return { kind: 'tree', nodes: toDataNodes(value) };
    } catch (error) {
      return { kind: 'error', message: error instanceof Error ? error.message : 'Unreadable document' };
    }
  });
  readonly conversations = computed(() => this.store.conversationsAbout(this.artifact().path));
  readonly selectedVersion = computed((): ArtifactVersion | null => this.artifact().versions[this.versionIndex()] ?? null);
  readonly previousVersion = computed((): ArtifactVersion | null => this.artifact().versions[this.versionIndex() + 1] ?? null);

  togglePanel(panel: 'versions'): void {
    this.panel.set(this.panel() === panel ? null : panel);
    this.versionIndex.set(0);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.overlay()) this.close.emit();
  }
}
