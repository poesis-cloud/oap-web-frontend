import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { SaiStore } from '../../state/sai-store';

@Component({
  selector: 'sai-organizations-page', standalone: true,
  host: { class: 'flex h-full min-h-0 flex-col' }, imports: [FormsModule, Button, Dialog, InputText],
  template: `
    <div class="pane-bar bg-surface"><span class="pane-title">Agentic Organizations</span><span class="pane-spacer"></span><span class="sai-chip">{{ store.instance.configuration }} instance</span></div>
    <div class="pane-body p-5 md:p-8"><div class="mx-auto max-w-5xl">
      <div class="sai-eyebrow mb-2">Choose how your workspace works</div><h1 class="m-0 text-2xl font-semibold">An organization, ready to work with you.</h1><p class="mb-6 max-w-2xl text-sm text-ink-muted">Agents, workflows and artifact contracts form one versioned package. Each workspace gets its own nominal import, conversations and history.</p>
      @for (org of store.offeredOrganizations(); track org.id) {
        <article class="sai-card mb-6 overflow-hidden">
          <div class="border-b border-line bg-ai-tint p-5"><div class="flex flex-wrap items-center justify-between gap-3"><h2 class="m-0 text-xl font-semibold">{{ org.name }}</h2><span class="sai-chip">{{ org.version }}</span></div><p class="mb-0 text-sm text-ink-muted">Portfolio decisions → program architecture → team delivery</p></div>
          <div class="p-5"><p class="mt-0 max-w-3xl text-sm">{{ org.intendedUse }}</p><div class="my-5 grid grid-cols-3 gap-3"><div><strong class="text-2xl">{{ org.agents.length - 1 }}</strong><div class="text-xs text-ink-muted">Organization agents</div></div><div><strong class="text-2xl">{{ org.workflows.length - 1 }}</strong><div class="text-xs text-ink-muted">SAF workflows</div></div><div><strong class="text-2xl">{{ org.itemTypes.length }}</strong><div class="text-xs text-ink-muted">Work item types</div></div></div>
          <p class="text-xs text-ink-muted">This specialized instance offers the SAFe package. The demo also provides one organization-change workflow candidate. New workspaces start with organization files and an empty backlog. Browser reload resets demonstration data.</p>
          <p-button label="Create a workspace" icon="pi pi-plus" (onClick)="selected.set(org.id); name.set(''); creating.set(true)" /></div>
        </article>
      }
      <h2 class="sai-eyebrow mb-3">Your workspaces · {{ store.tenant().organizationName }}</h2>
      <div class="grid gap-3 sm:grid-cols-2">@for (ws of store.workspaces(); track ws.id) { <button type="button" class="sai-card p-4 text-left" (click)="open(ws.id)"><strong>{{ ws.name }}</strong><p class="mb-0 text-xs text-ink-muted">{{ ws.organizationPackage.version }} · {{ ws.id === store.workspaceId() ? 'Current workspace' : 'Open workspace →' }}</p></button> }</div>
    </div></div>
    <p-dialog [visible]="creating()" (visibleChange)="creating.set($event)" [modal]="true" [draggable]="false" header="Create a workspace" [style]="{ width: 'min(480px, 94vw)' }">
      <form (submit)="create($event)" class="flex flex-col gap-4"><div><label for="workspace-name" class="mb-2 block text-sm">Workspace name</label><input pInputText id="workspace-name" name="workspaceName" class="w-full" maxlength="80" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="e.g. Partner Experience" required /></div><p class="m-0 text-sm text-ink-muted">Created in {{ store.tenant().organizationName }} using the SAFe package. Its repository and nominal import are simulated locally.</p><div class="flex justify-end gap-2"><p-button label="Cancel" [text]="true" severity="secondary" (onClick)="creating.set(false)" /><p-button label="Create workspace" type="submit" [disabled]="!name().trim()" /></div></form>
    </p-dialog>
  `,
})
export class OrganizationsPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly creating = signal(false);
  readonly name = signal('');
  readonly selected = signal('');
  create(event: Event): void { event.preventDefault(); const id = this.store.createWorkspace(this.name(), this.selected()); if (id) { this.creating.set(false); this.open(id); } }
  open(id: string): void { this.store.workspaceId.set(id); void this.router.navigate(['/workspace/explorer']); }
}
