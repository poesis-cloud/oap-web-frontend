import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';

/**
 * Read-only renderer of the Markdown subset used by SAF artifacts: headings, paragraphs,
 * bullet lists, pipe tables, fenced code and inline code/bold. It builds DOM from a parsed
 * block model through the template, never through innerHTML, so artifact content (untrusted
 * data produced by agents) cannot inject markup or scripts (F5-R9, OWASP A03).
 */

export type Inline = { kind: 'text' | 'code' | 'strong'; text: string };
export type Block =
  | { kind: 'heading'; level: number; inlines: Inline[] }
  | { kind: 'paragraph'; inlines: Inline[] }
  | { kind: 'list'; items: Inline[][] }
  | { kind: 'quote'; inlines: Inline[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'rule' };

export function parseInlines(text: string): Inline[] {
  const inlines: Inline[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) inlines.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1]) inlines.push({ kind: 'code', text: match[1].slice(1, -1) });
    else if (match[2]) inlines.push({ kind: 'strong', text: match[2].slice(2, -2) });
    last = index + match[0].length;
  }
  if (last < text.length) inlines.push({ kind: 'text', text: text.slice(last) });
  return inlines;
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  // HTML comments (license headers of the SAF files) are not content: dropped, never rendered.
  const lines = markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = /^```\s*([a-zA-Z0-9-]*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: 'code', lang: fence[1] ?? '', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, inlines: parseInlines(heading[2].trim()) });
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'rule' });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', inlines: parseInlines(quote.join(' ')) });
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i += 1;
      }
      if (rows.length > 0) {
        const [header, ...body] = rows;
        blocks.push({ kind: 'table', header: header.map(parseInlines), rows: body.map((r) => r.map(parseInlines)) });
      }
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(parseInlines(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>\s?|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraph.join(' ')) });
    else i += 1;
  }
  return blocks;
}

@Component({
  selector: 'sai-markdown',
  standalone: true,
  template: `
    <div class="md">
      @for (block of blocks(); track $index) {
        @switch (block.kind) {
          @case ('heading') {
            @if (block.level <= 1) {
              <h2><ng-container *ngTemplateOutlet="inl; context: { $implicit: block.inlines }" /></h2>
            } @else if (block.level === 2) {
              <h3><ng-container *ngTemplateOutlet="inl; context: { $implicit: block.inlines }" /></h3>
            } @else {
              <h4><ng-container *ngTemplateOutlet="inl; context: { $implicit: block.inlines }" /></h4>
            }
          }
          @case ('paragraph') {
            <p><ng-container *ngTemplateOutlet="inl; context: { $implicit: block.inlines }" /></p>
          }
          @case ('quote') {
            <blockquote><ng-container *ngTemplateOutlet="inl; context: { $implicit: block.inlines }" /></blockquote>
          }
          @case ('list') {
            <ul>
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inl; context: { $implicit: item }" /></li>
              }
            </ul>
          }
          @case ('table') {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    @for (cell of block.header; track $index) {
                      <th><ng-container *ngTemplateOutlet="inl; context: { $implicit: cell }" /></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of block.rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td><ng-container *ngTemplateOutlet="inl; context: { $implicit: cell }" /></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @case ('code') {
            <pre><code>{{ block.text }}</code></pre>
          }
          @case ('rule') {
            <hr />
          }
        }
      }
    </div>
    <ng-template #inl let-inlines>
      @for (part of inlines; track $index) {
        @switch (part.kind) {
          @case ('code') {
            <code>{{ part.text }}</code>
          }
          @case ('strong') {
            <strong>{{ part.text }}</strong>
          }
          @default {
            {{ part.text }}
          }
        }
      }
    </ng-template>
  `,
  styles: `
    .md {
      font-size: 0.92rem;
      line-height: 1.65;
      color: var(--sai-text);
    }
    .md h2 {
      font-size: 1.2rem;
      margin: 0.2rem 0 0.5rem;
    }
    .md h3 {
      font-size: 1rem;
      margin: 1.2rem 0 0.4rem;
    }
    .md h4 {
      font-size: 0.9rem;
      margin: 1rem 0 0.3rem;
      color: var(--sai-text-muted);
    }
    .md p {
      margin: 0 0 0.75rem;
    }
    .md blockquote {
      margin: 0.5rem 0;
      padding: 0.4rem 0.9rem;
      border-left: 3px solid var(--sai-gate);
      background: var(--sai-gate-tint);
      border-radius: 0 6px 6px 0;
      color: var(--sai-text-muted);
    }
    .md ul {
      padding-left: 1.2rem;
      margin: 0.3rem 0 0.8rem;
      list-style: disc;
    }
    .md hr {
      border: 0;
      border-top: 1px solid var(--sai-border);
      margin: 1rem 0;
    }
    .table-wrap {
      overflow-x: auto;
      margin: 0.5rem 0 1rem;
    }
    .md table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
    }
    .md th,
    .md td {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--sai-border);
      vertical-align: top;
    }
    .md th {
      color: var(--sai-text-muted);
      font-weight: 600;
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .md pre {
      margin: 0.4rem 0 0.9rem;
    }
  `,
  imports: [NgTemplateOutlet],
})
export class MarkdownView {
  readonly source = input.required<string>();
  readonly blocks = computed(() => parseBlocks(this.source()));
}
