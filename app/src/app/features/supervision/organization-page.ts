import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { CATEGORY_LABELS, organizationCategory, ORGANIZATION_ROOT, type OrganizationCategory } from '../../core/application/organization-view';
import type { Artifact } from '../../core/domain/artifact';
import { ActorBadge, ClockPipe, TitlePipe, fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { SaiStore } from '../../state/sai-store';

const ORGANIZATION_WORKFLOWS = [
  { slug: 'organization-change', feature: 'SF11', text: 'Applies an improvement decided in a retrospective: drafting, challenge, harness validation, ★ Organization gate, commit. A rollback is the same workflow with a revert.' },
  { slug: 'organization-upgrade', feature: 'SF13', text: 'Moves the workspace to a new package version by a three-way merge; conflicts are decided at the gate.' },
  { slug: 'organization-change scorecard', feature: 'SF12', text: 'Measures every accepted change after enough runs: cost per accepted artifact, first-pass acceptance, gate returns, recurrence of pain points.' },
  { slug: 'pain-point capture', feature: 'SF10', text: 'Orchestrators record pain points from harness signals and human reports, with evidence.' },
] as const;

const FOLDER_OF: Record<OrganizationCategory, string> = { agent: 'agents', workflow: 'workflows', skill: 'skills', instruction: 'instructions', schema: 'artifacts', template: 'artifacts', configuration: 'conf', manifest: '', other: '' };
const PLURALS: Record<OrganizationCategory, string> = { agent: 'Agents', workflow: 'Workflows', skill: 'Skills', instruction: 'Instruction files', schema: 'Artifact schemas', template: 'Artifact templates', configuration: 'Configuration files', manifest: 'Manifest files', other: 'Files' };

/**
 * Supervision › Organization (Clément, 2026-11-08/09): the change propositions (each opens a
 * conversation, F16-R11), the indicators of what the organization declares as clickable
 * analytics leading to the explorer or the viewer, the gates and their holders, the SAF
 * workflows still to create, and the history with the gap to nominal. The files themselves
 * are browsed in Workspace › Explorer under `organization/`.
 */
@Component({
  selector: 'sai-organization-page',
  standalone: true,
  imports: [RouterLink, Button, Viewer, ActorBadge, ClockPipe, TitlePipe],
  templateUrl: './organization-page.html',
})
export class OrganizationPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly root = ORGANIZATION_ROOT;
  readonly organizationWorkflows = ORGANIZATION_WORKFLOWS;
  readonly viewing = signal<string | null>(null);
  readonly organization = this.store.organization;
  readonly nominalTag = computed(() => {
    const sha = this.store.workspace().nominalImportCommit;
    return this.store.commits().find((c) => c.sha === sha)?.tag ?? null;
  });
  readonly categories = computed(() => {
    const counts = new Map<OrganizationCategory, number>();
    for (const path of this.store.paths()) {
      if (!path.startsWith(`${ORGANIZATION_ROOT}/`)) continue;
      const c = organizationCategory(path);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return (Object.keys(CATEGORY_LABELS) as OrganizationCategory[])
      .filter((c) => c !== 'other' && (counts.get(c) ?? 0) > 0)
      .map((c) => ({ key: c, label: PLURALS[c], count: counts.get(c) ?? 0, folder: FOLDER_OF[c] }));
  });
  readonly orchestrators = computed(() => this.organization().agents.filter((a) => a.kind === 'orchestrator'));
  readonly specialists = computed(() => this.organization().agents.filter((a) => a.kind === 'specialist'));
  readonly gates = computed(() => this.organization().workflows.filter((w) => w.gate).map((w) => ({ workflow: w, gate: w.gate! })));
  readonly viewed = computed((): Artifact | null => {
    const path = this.viewing();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });

  holders(role: string): string {
    return this.store.tenant().members.filter((m) => m.roles.includes(role)).map((m) => m.displayName).join(', ') || 'nobody in this tenant';
  }
  propose(kind: 'change' | 'upgrade' | 'rollback' | 'poesis'): void {
    const conversation = this.store.proposeOrganizationAction(kind);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
  fileName(path: string): string {
    return fileName(path);
  }
  discuss(path: string): void {
    this.viewing.set(null);
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
