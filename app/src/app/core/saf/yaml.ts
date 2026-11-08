/**
 * A small YAML reader for the subset SAF artifacts and configuration use: block mappings,
 * block sequences (of scalars or mappings), inline lists, quoted strings, comments, `---`
 * document markers and literal/folded block scalars (`|`, `>`). It exists so that the
 * workspace viewers can show YAML as a collapsible tree (F5-R9) without a YAML dependency;
 * anything it cannot read falls back to the raw source. It never evaluates anything.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  readonly indent: number;
  readonly text: string;
  readonly raw: string;
}

export class YamlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line + 1})`);
    this.name = 'YamlError';
  }
}

export function parseYaml(source: string): YamlValue {
  const lines = tokenize(source);
  if (lines.length === 0) return null;
  const [value, next] = parseBlock(lines, 0, lines[0].indent);
  if (next < lines.length) throw new YamlError('Unexpected content', lines[next].lineNo);
  return value;
}

interface Token extends Line {
  readonly lineNo: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const raw = source.replace(/\r\n/g, '\n').split('\n');
  let inBlockScalar: { indent: number } | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i];
    if (inBlockScalar) {
      // Block scalar bodies keep their lines verbatim until indentation drops.
      if (line.trim() === '' || line.search(/\S/) > inBlockScalar.indent) {
        tokens.push({ indent: inBlockScalar.indent + 1, text: line, raw: line, lineNo: i });
        continue;
      }
      inBlockScalar = null;
    }
    if (/^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line)) continue;
    const stripped = stripComment(line);
    if (stripped.trim() === '') continue;
    const indent = stripped.search(/\S/);
    const text = stripped.trim();
    tokens.push({ indent, text, raw: line, lineNo: i });
    if (/:\s*[|>][-+]?\s*$/.test(text) || /^-\s+[|>][-+]?\s*$/.test(text)) inBlockScalar = { indent };
  }
  return tokens;
}

function parseBlock(lines: Token[], start: number, indent: number): [YamlValue, number] {
  const first = lines[start];
  if (!first) return [null, start];
  if (first.text.startsWith('- ') || first.text === '-') return parseSequence(lines, start, indent);
  if (keyMatch(first.text)) return parseMapping(lines, start, indent);
  // A bare scalar block (multi-line plain scalar).
  const parts: string[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent >= indent && !keyMatch(lines[i].text) && !lines[i].text.startsWith('- ')) {
    parts.push(lines[i].text);
    i += 1;
  }
  return [parseScalar(parts.join(' ')), i];
}

function parseMapping(lines: Token[], start: number, indent: number): [YamlValue, number] {
  const result: { [key: string]: YamlValue } = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('Bad indentation', line.lineNo);
    const match = keyMatch(line.text);
    if (!match) throw new YamlError('Expected a key', line.lineNo);
    const [, key, rest] = match;
    i += 1;
    if (/^[|>][-+]?$/.test(rest)) {
      const [text, next] = readBlockScalar(lines, i, line.indent, rest.startsWith('>'));
      result[key] = text;
      i = next;
    } else if (rest === '') {
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        result[key] = value;
        i = next;
      } else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ')) {
        // Sequence at the same indentation as its key is valid YAML.
        const [value, next] = parseSequence(lines, i, indent);
        result[key] = value;
        i = next;
      } else {
        result[key] = null;
      }
    } else {
      result[key] = parseInline(rest);
    }
  }
  return [result, i];
}

function parseSequence(lines: Token[], start: number, indent: number): [YamlValue, number] {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('Bad indentation', line.lineNo);
    if (!(line.text === '-' || line.text.startsWith('- '))) break;
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    i += 1;
    if (rest === '') {
      if (i < lines.length && lines[i].indent > indent) {
        const [value, next] = parseBlock(lines, i, lines[i].indent);
        items.push(value);
        i = next;
      } else items.push(null);
      continue;
    }
    if (/^[|>][-+]?$/.test(rest)) {
      const [text, next] = readBlockScalar(lines, i, line.indent, rest.startsWith('>'));
      items.push(text);
      i = next;
      continue;
    }
    const kv = keyMatch(rest);
    if (kv) {
      // "- key: value" opens a mapping whose further keys are indented by two.
      const innerIndent = indent + 2;
      const synthetic: Token = { indent: innerIndent, text: rest, raw: line.raw, lineNo: line.lineNo };
      const rebuilt = [synthetic, ...collectIndented(lines, i, innerIndent)];
      const [value, consumed] = parseMapping(rebuilt, 0, innerIndent);
      items.push(value);
      i += consumed - 1;
      continue;
    }
    items.push(parseInline(rest));
  }
  return [items, i];
}

function collectIndented(lines: Token[], start: number, indent: number): Token[] {
  const out: Token[] = [];
  let i = start;
  while (i < lines.length && lines[i].indent >= indent) {
    out.push(lines[i]);
    i += 1;
  }
  return out;
}

function readBlockScalar(lines: Token[], start: number, parentIndent: number, folded: boolean): [string, number] {
  const body: string[] = [];
  let i = start;
  let base: number | null = null;
  while (i < lines.length && (lines[i].raw.trim() === '' || lines[i].raw.search(/\S/) > parentIndent)) {
    const raw = lines[i].raw;
    if (raw.trim() !== '' && base === null) base = raw.search(/\S/);
    body.push(base === null ? '' : raw.slice(Math.min(base, raw.search(/\S/) === -1 ? base : raw.search(/\S/))));
    i += 1;
  }
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return [folded ? body.join(' ').replace(/\s+/g, ' ').trim() : body.join('\n'), i];
}

function keyMatch(text: string): [string, string, string] | null {
  // A key is a quoted string or a plain token without ':' ; the value, if any, follows ": ".
  const match = /^("[^"]*"|'[^']*'|[^\s#\-[\]{},][^:]*?)\s*:(?:\s+(.*))?$/.exec(text);
  if (!match) return null;
  return [match[0], match[1].replace(/^["']|["']$/g, ''), (match[2] ?? '').trim()];
}

function parseInline(text: string): YamlValue {
  const value = text.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner === '' ? [] : splitTopLevel(inner).map((part) => parseInline(part));
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const out: { [key: string]: YamlValue } = {};
    for (const part of inner === '' ? [] : splitTopLevel(inner)) {
      const kv = keyMatch(part.trim());
      if (kv) out[kv[1]] = parseInline(kv[2]);
    }
    return out;
  }
  return parseScalar(value);
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  return parts;
}

export function parseScalar(raw: string): string | number | boolean | null {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === 'true' || value === 'True') return true;
  if (value === 'false' || value === 'False') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    return value.slice(1, -1);
  return value;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1])))
      return line.slice(0, i).trimEnd();
  }
  return line;
}
