import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PrimeTemplate, type TreeNode } from 'primeng/api';
import { Button } from 'primeng/button';
import { Tab, TabList, Tabs } from 'primeng/tabs';
import { Tag } from 'primeng/tag';
import { Tree } from 'primeng/tree';
import { map } from 'rxjs';
import {
  CATEGORY_LABELS,
  organizationCategory,
  ORGANIZATION_ROOT,
  type OrganizationCategory,
} from '../../core/application/organization-view';
import type { TreeEntry } from '../../core/application/workspace-tree';
import { artifactFormat, type Artifact } from '../../core/domain/artifact';
import {
  CAPABILITY_TAGS,
  type AgentDefinition,
  type StepDefinition,
  type WorkflowDefinition,
} from '../../core/domain/organization';
import { Actor } from '../../core/domain/types';
import { ArtifactViewer } from '../../shared/artifact-viewer';
import { ActorBadge, ClockPipe, TitlePipe, fileName } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

type View = 'overview' | 'agents' | 'workflows' | 'browse' | 'history';

/** SAF features that will make the organization evolve; none is in the package yet (saf-agentic-organization issues). */
const ORGANIZATION_WORKFLOWS = [
  {
    slug: 'organization-change',
    feature: 'SF11',
    issue: 'saf-agentic-organization#20',
    text: 'Applies an improvement decided in a retrospective: drafting by the owning agent, challenge, harness validation, ★ Organization gate, commit. A rollback is the same workflow with a revert.',
  },
  {
    slug: 'organization-upgrade',
    feature: 'SF13',
    issue: 'saf-agentic-organization#22',
    text: 'Moves the workspace to a new package version by a three-way merge; conflicts are decided at the gate; the commit becomes the new nominal import.',
  },
  {
    slug: 'organization-change scorecard',
    feature: 'SF12',
    issue: 'saf-agentic-organization#21',
    text: 'Measures every accepted change after a minimal volume of runs: cost per accepted artifact, first-pass acceptance, gate returns, recurrence of pain points.',
  },
  {
    slug: 'pain-point capture',
    feature: 'SF10',
    issue: 'saf-agentic-organization#19',
    text: 'Orchestrators record pain points from harness signals and human reports, with evidence, so that retrospectives work from facts.',
  },
] as const;

/**
 * Organization (Clément, 2026-11-08: a fourth menu entry, "everything in the SAF
 * organization"). The organization of the workspace lives in the workspace git under
 * `organization/`, imported from the SAF package as one tagged commit and changed only by
 * governed runs (oap#1 F16, S61). Read-only in its native formats; every action opens a
 * conversation with the orchestrator (F16-R11).
 */
@Component({
  selector: 'sai-organization-page',
  standalone: true,
  imports: [
    RouterLink,
    PrimeTemplate,
    Button,
    Tabs,
    TabList,
    Tab,
    Tag,
    Tree,
    ArtifactViewer,
    ActorBadge,
    ClockPipe,
    TitlePipe,
  ],
  templateUrl: './organization-page.html',
})
export class OrganizationPage {
  readonly store = inject(SaiStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly view = input<View | string>('overview');
  readonly selectedPath = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('path'))), {
    initialValue: null as string | null,
  });
  readonly tags = CAPABILITY_TAGS;
  readonly organizationWorkflows = ORGANIZATION_WORKFLOWS;
  readonly root = ORGANIZATION_ROOT;

  readonly organization = this.store.organization;
  readonly nominalTag = computed(() => {
    const sha = this.store.workspace().nominalImportCommit;
    return this.store.commits().find((c) => c.sha === sha)?.tag ?? null;
  });
  readonly head = computed(() => this.store.commits().at(-1)?.sha ?? null);
  readonly counts = computed(() => {
    const counts: Record<OrganizationCategory, number> = {
      agent: 0,
      workflow: 0,
      skill: 0,
      instruction: 0,
      schema: 0,
      template: 0,
      configuration: 0,
      manifest: 0,
      other: 0,
    };
    for (const path of this.store.paths()) {
      if (path.startsWith(`${ORGANIZATION_ROOT}/`)) counts[organizationCategory(path)] += 1;
    }
    return counts;
  });
  readonly categories = computed(() =>
    (Object.keys(CATEGORY_LABELS) as OrganizationCategory[])
      .filter((c) => c !== 'other' && this.counts()[c] > 0)
      .map((c) => ({ key: c, label: PLURALS[c], count: this.counts()[c], folder: FOLDER_OF[c] })),
  );
  readonly layers = computed(() =>
    (['portfolio', 'program', 'team'] as const).map((layer) => ({
      layer,
      workflows: this.organization().workflows.filter((w) => w.layer === layer),
    })),
  );
  readonly orchestrators = computed(() => this.organization().agents.filter((a) => a.kind === 'orchestrator'));
  readonly specialists = computed(() => this.organization().agents.filter((a) => a.kind === 'specialist'));
  readonly dispatcher = computed(() => this.organization().agents.find((a) => a.kind === 'dispatcher') ?? null);

  // Browse
  readonly treeNodes = computed(() => this.store.organizationTree().map((e) => this.toNode(e, 0)));
  readonly treeSelection = signal<TreeNode | null>(null);
  readonly selected = computed((): Artifact | null => {
    const path = this.selectedPath();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });
  readonly selectedCategory = computed(() =>
    this.selectedPath() ? CATEGORY_LABELS[organizationCategory(this.selectedPath()!)] : null,
  );
  readonly expandedWorkflow = signal<string | null>(null);

  constructor() {
    effect(() => {
      const path = this.selectedPath();
      this.treeSelection.set(path ? (this.findNode(this.treeNodes(), path) ?? null) : null);
    });
  }

  // ---- helpers

  agentRef(slug: string) {
    return Actor.agent(slug);
  }
  agentSource(agent: AgentDefinition): string | null {
    return agent.source ? `${ORGANIZATION_ROOT}/${agent.source}` : null;
  }
  workflowSource(w: WorkflowDefinition): string | null {
    return w.source ? `${ORGANIZATION_ROOT}/${w.source}` : null;
  }
  writes(agent: AgentDefinition): readonly string[] {
    return this.organization().roles.find((r) => r.slug === agent.slug)?.artifacts ?? [];
  }
  holders(role: string): string[] {
    return this.store
      .tenant()
      .members.filter((m) => m.roles.includes(role))
      .map((m) => m.displayName);
  }
  toggleWorkflow(w: WorkflowDefinition): void {
    this.expandedWorkflow.set(this.expandedWorkflow() === w.slug ? null : w.slug);
  }
  after(s: StepDefinition): string {
    return s.conditions.map((c) => c.step).join(', ');
  }
  fileName(path: string): string {
    return fileName(path);
  }
  propose(kind: 'change' | 'upgrade' | 'rollback' | 'poesis'): void {
    const conversation = this.store.proposeOrganizationAction(kind);
    if (conversation) void this.router.navigate(['/conversations', conversation.id]);
  }
  discuss(path: string): void {
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversations', conversation.id]);
  }
  onSelect(event: { node: TreeNode }): void {
    const entry = event.node.data as TreeEntry | undefined;
    if (!entry || entry.kind !== 'file') return;
    void this.router.navigate(['/organization', 'browse'], { queryParams: { path: entry.path } });
  }

  private toNode(entry: TreeEntry, depth: number): TreeNode<TreeEntry> {
    if (entry.kind === 'folder') {
      return {
        key: entry.path,
        label: entry.name,
        data: entry,
        icon: 'pi pi-folder text-ink-light',
        // Agents, workflows and conf open by default (the entry points); long folders stay folded.
        expanded:
          (depth === 0 && OPEN_FOLDERS.has(entry.name)) || (this.selectedPath()?.startsWith(`${entry.path}/`) ?? false),
        selectable: false,
        children: entry.children.map((c) => this.toNode(c, depth + 1)),
        leaf: entry.children.length === 0,
      };
    }
    const format = artifactFormat(entry.path);
    return {
      key: entry.path,
      label: entry.name,
      data: entry,
      icon: format === 'markdown' ? 'pi pi-file-edit text-primary' : 'pi pi-code text-ai',
      leaf: true,
    };
  }

  private findNode(nodes: readonly TreeNode[], path: string): TreeNode | undefined {
    for (const node of nodes) {
      if (node.key === path) return node;
      const hit = node.children ? this.findNode(node.children, path) : undefined;
      if (hit) return hit;
    }
    return undefined;
  }
}

const OPEN_FOLDERS = new Set(['agents', 'workflows', 'conf']);

const PLURALS: Record<OrganizationCategory, string> = {
  agent: 'Agent definitions',
  workflow: 'Workflow definitions',
  skill: 'Skills',
  instruction: 'Instruction files',
  schema: 'Artifact schemas',
  template: 'Artifact templates',
  configuration: 'Configuration files',
  manifest: 'Package manifest files',
  other: 'Files',
};

const FOLDER_OF: Record<OrganizationCategory, string> = {
  agent: 'agents',
  workflow: 'workflows',
  skill: 'skills',
  instruction: 'instructions',
  schema: 'artifacts',
  template: 'artifacts',
  configuration: 'conf',
  manifest: '',
  other: '',
};
