import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { Tag } from 'primeng/tag';
import { toDataNodes, type DataNode } from '../core/application/data-tree';
import { artifactFormat, type Artifact } from '../core/domain/artifact';
import { parseArtifact } from '../core/saf/frontmatter';
import { parseYaml } from '../core/saf/yaml';
import { SaiStore } from '../state/sai-store';
import { DataTreeView } from './data-tree-view';
import { MarkdownView } from './markdown-view';
import { ActorBadge, ClockPipe, StatusBadge, fileName } from './ui';

type Parsed = { kind: 'tree'; nodes: DataNode[] } | { kind: 'error'; message: string };

/**
 * Read-only preview of a workspace artifact in its native format (F5-R7, F5-R9): Markdown
 * rendered with its frontmatter fields, JSON and YAML as collapsible trees, anything else as
 * text; the source and the version history one tab away. No viewer edits (R15).
 */
@Component({
  selector: 'sai-artifact-viewer',
  standalone: true,
  imports: [
    RouterLink,
    Button,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    Tag,
    DataTreeView,
    MarkdownView,
    ActorBadge,
    StatusBadge,
    ClockPipe,
  ],
  template: `
    <article class="sai-card flex flex-col gap-3 p-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate font-mono text-xs text-ink-muted" [title]="artifact().path">{{ artifact().path }}</div>
          <h2 class="mt-0.5 text-lg">{{ title() }}</h2>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            @if (kind()) {
              <p-tag [value]="kind()!" severity="contrast" [rounded]="true" />
            }
            @if (status()) {
              <sai-status [status]="status()!" />
            }
            <p-tag [value]="format()" severity="secondary" [rounded]="true" />
            <span class="text-xs text-ink-light"
              >v{{ artifact().versions.length }} · {{ artifact().head.commit.timestamp | clock }}</span
            >
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          @for (c of conversations(); track c.id) {
            <a class="text-sm" [routerLink]="['/conversations', c.id]"
              ><i class="pi pi-comments text-[0.8em]"></i> {{ c.title }}</a
            >
          }
          <p-button
            label="Discuss"
            icon="pi pi-comments"
            size="small"
            [outlined]="true"
            (onClick)="discuss.emit(artifact().path)"
          />
        </div>
      </header>

      <p-tabs [(value)]="tab">
        <p-tablist>
          <p-tab value="rendered">Rendered</p-tab>
          <p-tab value="source">Source</p-tab>
          <p-tab value="history">History ({{ artifact().versions.length }})</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="rendered">
            <div class="pt-3">
              @switch (format()) {
                @case ('markdown') {
                  @if (parsed().frontmatterPresent) {
                    <details class="sai-fold mb-3" open>
                      <summary>Frontmatter{{ kind() ? ' · fields of the SAF ' + kind() + ' schema' : '' }}</summary>
                      <table class="sai-table mt-1">
                        <tbody>
                          @for (entry of frontmatterEntries(); track entry[0]) {
                            <tr>
                              <th class="w-[30%] normal-case tracking-normal">{{ entry[0] }}</th>
                              <td class="font-mono text-xs">{{ entry[1] }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </details>
                  }
                  <sai-markdown [source]="parsed().body" />
                }
                @case ('yaml') {
                  @if (data().kind === 'tree') {
                    <sai-data-tree [data]="$any(data()).nodes" [expandDepth]="2" />
                  } @else {
                    <p class="mb-2 text-xs text-warn">{{ $any(data()).message }} — showing the source.</p>
                    <pre>{{ artifact().head.content }}</pre>
                  }
                }
                @case ('json') {
                  @if (data().kind === 'tree') {
                    <sai-data-tree [data]="$any(data()).nodes" [expandDepth]="1" />
                  } @else {
                    <p class="mb-2 text-xs text-warn">{{ $any(data()).message }} — showing the source.</p>
                    <pre>{{ artifact().head.content }}</pre>
                  }
                }
                @default {
                  <pre>{{ artifact().head.content }}</pre>
                }
              }
            </div>
          </p-tabpanel>
          <p-tabpanel value="source">
            <pre class="mt-3 max-h-[70vh]">{{ artifact().head.content }}</pre>
          </p-tabpanel>
          <p-tabpanel value="history">
            <table class="sai-table mt-3">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Commit</th>
                  <th>When</th>
                  <th>Author</th>
                  <th>Run / step</th>
                </tr>
              </thead>
              <tbody>
                @for (v of artifact().versions; track v.commit.sha; let i = $index) {
                  <tr>
                    <td>v{{ artifact().versions.length - i }}</td>
                    <td class="font-mono text-xs">{{ v.commit.sha.slice(0, 10) }}</td>
                    <td>{{ v.commit.timestamp | clock }}</td>
                    <td>
                      @if (v.commit.author.kind === 'agent' || v.commit.author.kind === 'human') {
                        <sai-actor [actor]="$any(v.commit.author)" />
                      } @else {
                        <p-tag [value]="v.commit.author.kind" severity="secondary" [rounded]="true" />
                      }
                    </td>
                    <td>
                      @if (v.commit.runId) {
                        <a [routerLink]="['/supervisor', 'runs', v.commit.runId]">{{ v.commit.runId }}</a>
                        <span class="text-ink-light">{{ v.commit.stepSlug ?? '' }}</span>
                      } @else {
                        <span class="text-ink-light">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
      <p class="m-0 text-xs text-ink-light">
        Read-only. Artifacts change only through runs validated by the harness (R15).
      </p>
    </article>
  `,
})
export class ArtifactViewer {
  private readonly store = inject(SaiStore);
  readonly artifact = input.required<Artifact>();
  /** Artifact kind from the organization (schema id), when known. */
  readonly kind = input<string | null>(null);
  readonly discuss = output<string>();
  readonly tab = signal<string | number | undefined>('rendered');

  readonly format = computed(() => artifactFormat(this.artifact().path));
  readonly parsed = computed(() => parseArtifact(this.artifact().head.content));
  readonly title = computed(() => this.parsed().title ?? fileName(this.artifact().path));
  readonly status = computed(() => {
    const s = this.parsed().frontmatter['status'];
    return typeof s === 'string' ? s : null;
  });
  readonly frontmatterEntries = computed((): [string, string][] =>
    Object.entries(this.parsed().frontmatter).map(([k, v]) => [
      k,
      Array.isArray(v) ? `[${v.join(', ')}]` : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v),
    ]),
  );
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
}
