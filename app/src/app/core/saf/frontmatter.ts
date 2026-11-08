/**
 * Minimal, dependency-free reader of the SAF artifact format: YAML frontmatter (flat scalars,
 * flat lists and one level of nested maps) followed by a Markdown body split by `## ` headings.
 * It covers what the SAI views need (status, title, id, sections) without pulling a YAML
 * library into the browser bundle. Schema validation itself is the harness's job (C5, C6).
 */

export type Scalar = string | number | boolean | null;
export type FrontmatterValue = Scalar | Scalar[] | Record<string, Scalar | Scalar[]>;

export interface ParsedArtifact {
  readonly frontmatter: Readonly<Record<string, FrontmatterValue>>;
  readonly frontmatterPresent: boolean;
  readonly body: string;
  readonly title: string | null;
  /** Section bodies keyed by their `## ` heading, in order of appearance. */
  readonly sections: ReadonlyArray<{ readonly heading: string; readonly body: string }>;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseArtifact(text: string): ParsedArtifact {
  const match = FRONTMATTER.exec(text);
  const frontmatter = match ? parseFrontmatter(match[1]) : {};
  const body = match ? text.slice(match[0].length) : text;
  const titleMatch = /^#\s+(.+)$/m.exec(body);
  const title =
    typeof frontmatter['title'] === 'string' ? (frontmatter['title'] as string) : (titleMatch?.[1]?.trim() ?? null);
  return { frontmatter, frontmatterPresent: Boolean(match), body, title, sections: splitSections(body) };
}

export function parseFrontmatter(yaml: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = stripComment(lines[i]);
    i += 1;
    if (!line.trim()) continue;
    const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!top) continue;
    const [, key, rawValue] = top;
    if (rawValue !== '') {
      result[key] = parseScalarOrInlineList(rawValue);
      continue;
    }
    // Block value: list of scalars or a one-level map.
    const items: Scalar[] = [];
    const map: Record<string, Scalar | Scalar[]> = {};
    let sawList = false;
    let sawMap = false;
    while (i < lines.length) {
      const next = lines[i];
      if (!/^\s+\S/.test(next)) break;
      const cleaned = stripComment(next).trim();
      i += 1;
      if (!cleaned) continue;
      if (cleaned.startsWith('- ')) {
        sawList = true;
        items.push(parseScalar(cleaned.slice(2).trim()));
      } else {
        const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(cleaned);
        if (kv) {
          sawMap = true;
          map[kv[1]] = kv[2] === '' ? null : parseScalarOrInlineList(kv[2]);
        }
      }
    }
    result[key] = sawList && !sawMap ? items : sawMap ? map : null;
  }
  return result;
}

function stripComment(line: string): string {
  // Remove `# comment` outside quotes.
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseScalarOrInlineList(raw: string): Scalar | Scalar[] {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }
  return parseScalar(value);
}

export function parseScalar(raw: string): Scalar {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function splitSections(body: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = [];
  const lines = body.split(/\r?\n/);
  let current: { heading: string; lines: string[] } | null = null;
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const heading = !inFence ? /^##\s+(.+)$/.exec(line) : null;
    if (heading) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: heading[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return sections;
}

/** Serialize a flat frontmatter object back to YAML (scalars, flat lists, one-level maps). */
export function serializeFrontmatter(data: Readonly<Record<string, FrontmatterValue>>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (value.length === 0) lines.push(`${key}: []`);
      else {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${serializeScalar(item)}`);
      }
    } else if (value !== null && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${Array.isArray(v) ? `[${v.map(serializeScalar).join(', ')}]` : serializeScalar(v)}`);
      }
    } else {
      lines.push(`${key}: ${serializeScalar(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function serializeScalar(value: Scalar): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    return /[:#\[\]{}',"]|^\s|\s$/.test(value) || value === '' ? JSON.stringify(value) : value;
  }
  return String(value);
}
