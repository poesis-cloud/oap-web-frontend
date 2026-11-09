/**
 * Line diff between two versions of an artifact, for the viewer's version button (Clément,
 * 2026-11-08: "version, dont diff system"). Longest-common-subsequence over lines; artifacts
 * are small text files, so the quadratic table is fine. Pure, no Angular.
 */

export interface DiffLine {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
  /** 1-based line numbers in the old and new texts; null when the line is absent from that side. */
  readonly oldNo: number | null;
  readonly newNo: number | null;
}

export interface DiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly lines: readonly DiffLine[];
}

export function diffLines(oldText: string, newText: string): DiffSummary {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // Removals before additions at equal choice, as diff tools show them.
      lines.push({ kind: 'removed', text: a[i], oldNo: i + 1, newNo: null });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: 'added', text: b[j], oldNo: null, newNo: j + 1 });
      added += 1;
      j += 1;
    }
  }
  return { added, removed, lines };
}

/** Keeps only the changed lines with `context` unchanged lines around them; `null` entries mark a gap. */
export function collapseUnchanged(lines: readonly DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
  });
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((line, index) => {
    if (keep[index]) {
      out.push(line);
      gap = false;
    } else if (!gap) {
      out.push(null);
      gap = true;
    }
  });
  return out;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}
