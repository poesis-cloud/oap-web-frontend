import type { YamlValue } from '../saf/yaml';

/**
 * A structured value (parsed JSON or YAML) as a tree the viewers can fold and unfold
 * (F5-R9). Leaves show their scalar; branches show their size. Field labels may come from a
 * SAF artifact schema when one is known for the file (`labels`).
 */
export interface DataNode {
  readonly key: string;
  readonly label: string;
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  readonly value: string | null;
  readonly size: number;
  readonly children: readonly DataNode[];
  readonly path: string;
}

export function toDataNodes(
  value: YamlValue | unknown,
  labels: Readonly<Record<string, string>> = {},
  path = '',
): DataNode[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => node(String(index), item, labels, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      node(key, item, labels, path ? `${path}.${key}` : key),
    );
  }
  return [node('value', value, labels, path)];
}

function node(key: string, value: unknown, labels: Readonly<Record<string, string>>, path: string): DataNode {
  const label = labels[key] ?? key;
  if (Array.isArray(value)) {
    return {
      key,
      label,
      type: 'array',
      value: null,
      size: value.length,
      children: toDataNodes(value, labels, path),
      path,
    };
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as object);
    return {
      key,
      label,
      type: 'object',
      value: null,
      size: entries.length,
      children: toDataNodes(value, labels, path),
      path,
    };
  }
  if (value === null || value === undefined)
    return { key, label, type: 'null', value: 'null', size: 0, children: [], path };
  if (typeof value === 'number')
    return { key, label, type: 'number', value: String(value), size: 0, children: [], path };
  if (typeof value === 'boolean')
    return { key, label, type: 'boolean', value: String(value), size: 0, children: [], path };
  return { key, label, type: 'string', value: String(value), size: 0, children: [], path };
}

export function countLeaves(nodes: readonly DataNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.children.length ? countLeaves(n.children) : 1), 0);
}
