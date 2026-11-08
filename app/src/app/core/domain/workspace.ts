import type { WorkspaceStatus } from './lifecycles';
import type { CommitSha, IsoDateTime, Member, TenantId, WorkspaceId } from './types';

/**
 * A workspace of a tenant (F17): the only workspace-level entity SAI stores. Its content
 * (artifacts, organization, run journals) lives in the hosted SAF workspace, a git
 * repository whose committed HEAD is the workspace state (F14), and is read through git.
 */
export interface Workspace {
  readonly id: WorkspaceId;
  /** The PIS Organization served (a tenant); the isolation scope, not an SAI domain object. */
  readonly tenantId: TenantId;
  readonly name: string;
  /** Address of the hosted SAF workspace repository (operated with the instance, R17). */
  readonly repository: string;
  readonly organizationPackage: { readonly id: string; readonly version: string };
  /** The tagged nominal-import commit (F14-R7); null while provisioning. */
  readonly nominalImportCommit: CommitSha | null;
  readonly status: WorkspaceStatus;
  readonly createdAt: IsoDateTime;
}

export interface Tenant {
  readonly id: TenantId;
  /** PIS Organization display name; SAI keeps no account registry (R9). */
  readonly organizationName: string;
  readonly members: readonly Member[];
  /** Budget in tokens for the demo runtime (F3): alerts then hard stop. */
  readonly budget: { readonly limitTokens: number; readonly alertAtRatio: number };
  readonly euOnly: boolean;
}

export function memberOf(tenant: Tenant, userId: string): Member | undefined {
  return tenant.members.find((m) => m.userId === userId);
}

export function holdsRole(tenant: Tenant, userId: string, role: string): boolean {
  return memberOf(tenant, userId)?.roles.includes(role) ?? false;
}
