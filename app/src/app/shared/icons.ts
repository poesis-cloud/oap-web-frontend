import { Component, computed, input } from '@angular/core';

export type FileIconKind = 'folder' | 'folder-open' | 'markdown' | 'yaml' | 'json' | 'jsonl' | 'text' | 'expected';

/** Quiet, consistent file glyphs (one stroke weight, format shown as a small tag), like an editor's. */
@Component({
  selector: 'sai-file-icon',
  standalone: true,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="sai-ficon" [class]="'sai-ficon is-' + kind()">
      @switch (kind()) {
        @case ('folder') {
          <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l1.7 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" />
        }
        @case ('folder-open') {
          <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h4l1.7 1.8H16a1.5 1.5 0 0 1 1.5 1.5V9H5.2a1.5 1.5 0 0 0-1.4 1l-1.3 4.2V5.5Z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.3" />
          <path d="M3.8 10a1 1 0 0 1 1-.8h12.4a.8.8 0 0 1 .8 1l-1.4 5a1 1 0 0 1-1 .8H3.1a.8.8 0 0 1-.8-1L3.8 10Z" stroke="currentColor" stroke-width="1.3" />
        }
        @case ('expected') {
          <path d="M5 2.5h6.5L15.5 6.5V16a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5Z" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.2 2" />
        }
        @default {
          <path d="M5 2.5h6.5L15.5 6.5V16a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16V4A1.5 1.5 0 0 1 5 2.5Z" fill="currentColor" fill-opacity="0.08" stroke="currentColor" stroke-width="1.3" />
          <path d="M11.5 2.5v4h4" stroke="currentColor" stroke-width="1.3" />
          @if (tag()) {
            <text x="9.5" y="14.6" text-anchor="middle" font-size="5.2" font-weight="700" font-family="ui-monospace, Menlo, monospace" fill="currentColor">{{ tag() }}</text>
          }
        }
      }
    </svg>
  `,
  styles: `
    .sai-ficon { color: var(--sai-text-light); flex: none; }
    .sai-ficon.is-folder, .sai-ficon.is-folder-open { color: var(--sai-folder, #b08a3c); }
    .sai-ficon.is-markdown { color: var(--sai-primary); }
    .sai-ficon.is-yaml, .sai-ficon.is-json, .sai-ficon.is-jsonl { color: var(--sai-ai); }
    .sai-ficon.is-expected { color: var(--sai-text-light); }
  `,
})
export class FileIcon {
  readonly kind = input.required<FileIconKind>();
  readonly size = input(18);
  readonly tag = computed(() => {
    switch (this.kind()) {
      case 'markdown':
        return 'md';
      case 'yaml':
        return 'yml';
      case 'json':
        return '{ }';
      case 'jsonl':
        return 'log';
      case 'text':
        return 'txt';
      default:
        return '';
    }
  });
}

export function iconKindFor(path: string, options: { folder?: boolean; open?: boolean; expected?: boolean } = {}): FileIconKind {
  if (options.folder) return options.open ? 'folder-open' : 'folder';
  if (options.expected) return 'expected';
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.jsonl')) return 'jsonl';
  if (path.endsWith('.json')) return 'json';
  return 'text';
}
