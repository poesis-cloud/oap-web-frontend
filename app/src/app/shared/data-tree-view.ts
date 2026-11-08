import { Component, computed, input } from '@angular/core';
import { PrimeTemplate, type TreeNode } from 'primeng/api';
import { Tree } from 'primeng/tree';
import type { DataNode } from '../core/application/data-tree';

interface Row {
  readonly label: string;
  readonly value: string | null;
  readonly type: DataNode['type'];
  readonly size: number;
}

/** JSON / YAML as a collapsible, highlighted tree (F5-R9), on PrimeNG Tree. Read-only. */
@Component({
  selector: 'sai-data-tree',
  standalone: true,
  imports: [Tree, PrimeTemplate],
  template: `
    <p-tree [value]="nodes()" styleClass="sai-data-tree" [filter]="filter()" filterPlaceholder="Filter fields">
      <ng-template let-node pTemplate="default">
        <span class="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[0.8rem]">
          <span class="text-ink-muted">{{ node.data.label }}</span>
          @if (node.data.value !== null) {
            <span [class]="valueClass(node.data.type)">{{ node.data.value }}</span>
          } @else {
            <span class="text-ink-light">{{
              node.data.type === 'array' ? '[' + node.data.size + ']' : '{' + node.data.size + '}'
            }}</span>
          }
        </span>
      </ng-template>
    </p-tree>
  `,
  styles: `
    :host ::ng-deep .sai-data-tree {
      padding: 0;
    }
    :host ::ng-deep .sai-data-tree .p-tree-node-content {
      padding: 0.1rem 0.3rem;
    }
  `,
})
export class DataTreeView {
  readonly data = input.required<readonly DataNode[]>();
  readonly expandDepth = input(1);
  readonly filter = input(false);
  readonly nodes = computed(() => this.data().map((n) => this.toNode(n, 0)));

  valueClass(type: DataNode['type']): string {
    switch (type) {
      case 'string':
        return 'text-ok break-words';
      case 'number':
        return 'text-info';
      case 'boolean':
        return 'text-ai';
      default:
        return 'text-ink-light italic';
    }
  }

  private toNode(n: DataNode, depth: number): TreeNode<Row> {
    return {
      key: n.path,
      label: n.value === null ? n.label : `${n.label}: ${n.value}`,
      data: { label: n.label, value: n.value, type: n.type, size: n.size },
      leaf: n.children.length === 0,
      expanded: depth < this.expandDepth(),
      children: n.children.map((c) => this.toNode(c, depth + 1)),
      selectable: false,
    };
  }
}
