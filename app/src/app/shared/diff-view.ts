import { Component, computed, input } from '@angular/core';
import { collapseUnchanged, diffLines, type DiffLine } from '../core/application/diff';

/** Unified line diff, read-only: removed lines tinted red, added lines green, gaps folded. */
@Component({
  selector: 'sai-diff',
  standalone: true,
  template: `
    <div class="sai-diff" role="table" [attr.aria-label]="summary().added + ' additions, ' + summary().removed + ' deletions'">
      <div class="sai-diff-head">
        <span class="text-ok">+{{ summary().added }}</span>
        <span class="text-fail">−{{ summary().removed }}</span>
        @if (summary().added === 0 && summary().removed === 0) {
          <span class="text-ink-light">identical</span>
        }
      </div>
      @for (line of rows(); track $index) {
        @if (line === null) {
          <div class="sai-diff-gap">⋯</div>
        } @else {
          <div class="sai-diff-row" [class.is-added]="line.kind === 'added'" [class.is-removed]="line.kind === 'removed'">
            <span class="sai-diff-no">{{ line.oldNo ?? '' }}</span>
            <span class="sai-diff-no">{{ line.newNo ?? '' }}</span>
            <span class="sai-diff-sign">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</span>
            <span class="sai-diff-text">{{ line.text }}</span>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .sai-diff { font-family: var(--sai-font-mono); font-size: 0.78rem; line-height: 1.5; border: 1px solid var(--sai-border); border-radius: var(--sai-radius-input); overflow: hidden; background: var(--sai-surface); }
    .sai-diff-head { display: flex; gap: 0.75rem; padding: 0.4rem 0.75rem; border-bottom: 1px solid var(--sai-border); background: var(--sai-surface-sunken); font-family: var(--sai-font-ui); font-size: 0.8rem; }
    .sai-diff-row { display: grid; grid-template-columns: 3rem 3rem 1.2rem 1fr; }
    .sai-diff-row.is-added { background: color-mix(in srgb, var(--sai-ok) 14%, transparent); }
    .sai-diff-row.is-removed { background: color-mix(in srgb, var(--sai-fail) 12%, transparent); }
    .sai-diff-no { padding: 0 0.5rem; text-align: right; color: var(--sai-text-light); user-select: none; }
    .sai-diff-sign { color: var(--sai-text-muted); user-select: none; }
    .sai-diff-text { white-space: pre-wrap; word-break: break-word; padding-right: 0.75rem; }
    .sai-diff-gap { padding: 0.15rem 0.75rem; color: var(--sai-text-light); background: var(--sai-surface-sunken); text-align: center; }
  `,
})
export class DiffView {
  readonly before = input.required<string>();
  readonly after = input.required<string>();
  readonly summary = computed(() => diffLines(this.before(), this.after()));
  readonly rows = computed((): (DiffLine | null)[] => collapseUnchanged(this.summary().lines, 3));
}
