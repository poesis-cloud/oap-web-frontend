import { SaiApplication, type Session } from '../core/application/sai-application';
import type { OrganizationPackage } from '../core/domain/organization';
import type { Tenant, Workspace } from '../core/domain/workspace';
import type { Clock, IdMinter, WorkspaceRepository } from '../core/ports';
import { StaticCatalog } from './agent-runtime/catalog';
import { MockAgentRuntime } from './agent-runtime/mock-runtime';
import { loadSafePackage } from './agent-runtime/package-loader';
import { ScriptedAgents } from './agent-runtime/scripted-agents';
import { InMemoryConversations, InMemoryNotifications } from './conversation-manager/in-memory-conversations';
import { MockKeycloak } from './iam/mock-keycloak';
import { MockFoundry } from './model-gateway/mock-foundry';
import { InMemoryWorkspace } from './workspace-manager/in-memory-workspace';
import type { OrganizationSources } from './workspace-manager/organization-sources';
import { seedWorkspace } from './workspace-manager/seed-workspace';

/**
 * Composition root of the mocked backends. The frontend is developed against five mocks that
 * stand for the services whose concepts are not settled yet (Clément, 2026-11-08):
 *
 * | Backend | Mock | Port |
 * | --- | --- | --- |
 * | workspace manager (`oap-workspace-manager`) | `InMemoryWorkspace`, `InMemoryWorkspaces` | `WorkspaceReadPort`, `WorkspaceRepository` |
 * | conversation manager (`oap-conversation-manager`) | `InMemoryConversations`, `InMemoryNotifications` | `ConversationRepository`, `NotificationStore` |
 * | agent runtime (`oap-agent-runtime`) | `MockAgentRuntime`, `ScriptedAgents`, `StaticCatalog` | `RuntimePort`, `AgentResponderPort`, `OrganizationCatalog` |
 * | PIS IAM (Keycloak) | `MockKeycloak` | `IdentityPort` |
 * | Azure AI Foundry (behind the Poesis Models Gateway) | `MockFoundry` | `ModelGatewayPort` |
 *
 * Two fictitious tenants (the second exists only to prove isolation), one active workspace
 * with its nominal import and a small SAFe backlog. Every mock is labelled as such in the UI.
 */

export class MonotonicClock implements Clock {
  private last = 0;
  constructor(private readonly source: () => number = () => Date.now()) {}
  now(): string {
    let ms = this.source();
    if (ms <= this.last) ms = this.last + 1;
    this.last = ms;
    return new Date(ms).toISOString();
  }
}

export class SequentialIds implements IdMinter {
  private readonly counters = new Map<string, number>();
  mint(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${String(n).padStart(4, '0')}`;
  }
}

export class InMemoryWorkspaces implements WorkspaceRepository {
  private readonly items = new Map<string, Workspace>();
  get(id: string): Workspace | undefined {
    return this.items.get(id);
  }
  listByTenant(tenantId: string): readonly Workspace[] {
    return [...this.items.values()].filter((w) => w.tenantId === tenantId);
  }
  save(workspace: Workspace): void {
    this.items.set(workspace.id, workspace);
  }
}

/**
 * The instance this build stands for: the **Specialized configuration** of OAP, serving the
 * SAFe Agentic Organization of SAF as its only package (oap#1: three configurations; Clément,
 * 2026-11-08: the Specialized SAFe configuration comes first).
 */
export const INSTANCE = {
  product: 'Organization Agentic Platform',
  shortName: 'OAP',
  configuration: 'Specialized' as const,
  pack: 'SAFe Agentic Organization',
  packId: 'saf-agentic-organization',
};

export const DEMO_TENANT_ID = 'acme-it';
export const DEMO_WORKSPACE_ID = 'ws-customer-platform';
export const DEMO_USER_ID = 'alex-moreau';
export const DEMO_MEMBER_WITHOUT_ROLE = 'sam-ortega';
export const DEMO_ADMIN_ID = 'priya-nair';
export const OTHER_TENANT_ID = 'globex';
export const OTHER_USER_ID = 'casey-lin';
export const OTHER_WORKSPACE_ID = 'ws-globex-ops';

export interface MockWorld {
  readonly app: SaiApplication;
  readonly session: Session;
  readonly otherSession: Session;
  readonly memberSession: Session;
  readonly adminSession: Session;
  readonly repository: InMemoryWorkspace;
  readonly runtime: MockAgentRuntime;
  readonly notifications: InMemoryNotifications;
  readonly gateway: MockFoundry;
  readonly clock: Clock;
  readonly tenant: Tenant;
  readonly workspace: Workspace;
  readonly organization: OrganizationPackage;
}

export function createMockWorld(
  options: { now?: () => number; sources?: OrganizationSources | null } = {},
): MockWorld {
  const clock = new MonotonicClock(options.now);
  const ids = new SequentialIds();
  const organization = loadSafePackage();
  const sources = options.sources ?? null;
  const tenant: Tenant = {
    id: DEMO_TENANT_ID,
    organizationName: 'Acme IT Department',
    members: [
      { userId: DEMO_USER_ID, displayName: 'Alex Moreau', permission: 'member', roles: ['central-supervisor'] },
      { userId: DEMO_MEMBER_WITHOUT_ROLE, displayName: 'Sam Ortega', permission: 'member', roles: [] },
      { userId: DEMO_ADMIN_ID, displayName: 'Priya Nair', permission: 'administrator', roles: ['central-supervisor'] },
    ],
    budget: { limitTokens: 120_000, alertAtRatio: 0.8 },
    euOnly: true,
  };
  const otherTenant: Tenant = {
    id: OTHER_TENANT_ID,
    organizationName: 'Globex Operations',
    members: [
      { userId: OTHER_USER_ID, displayName: 'Casey Lin', permission: 'administrator', roles: ['central-supervisor'] },
    ],
    budget: { limitTokens: 50_000, alertAtRatio: 0.8 },
    euOnly: true,
  };

  // Mocked backends.
  const repository = new InMemoryWorkspace();
  const workspaces = new InMemoryWorkspaces();
  const conversations = new InMemoryConversations();
  const notifications = new InMemoryNotifications();
  const gateway = new MockFoundry(undefined, organization.modelProfiles);
  const iam = new MockKeycloak([tenant, otherTenant]);
  const runtime = new MockAgentRuntime(
    repository,
    gateway,
    clock,
    ids,
    (workspaceId) => workspaces.get(workspaceId)?.tenantId ?? 'unknown',
  );

  const workspace = seedWorkspace(repository, workspaces, clock, {
    id: DEMO_WORKSPACE_ID,
    tenantId: DEMO_TENANT_ID,
    name: 'Customer Platform',
    repository: 'git://oap-instance.local/acme-it/customer-platform.git',
    organization,
    sources,
    withBacklog: true,
  });
  seedWorkspace(repository, workspaces, clock, {
    id: OTHER_WORKSPACE_ID,
    tenantId: OTHER_TENANT_ID,
    name: 'Globex Ops Tooling',
    repository: 'git://oap-instance.local/globex/ops-tooling.git',
    organization,
    sources,
    withBacklog: false,
  });

  const app = new SaiApplication({
    clock,
    ids,
    identity: iam,
    workspaces,
    conversations,
    notifications,
    organizations: new StaticCatalog([organization]),
    workspaceRead: repository,
    runtime,
    responder: new ScriptedAgents(),
    gateway,
  });
  return {
    app,
    session: { userId: DEMO_USER_ID, tenantId: DEMO_TENANT_ID },
    memberSession: { userId: DEMO_MEMBER_WITHOUT_ROLE, tenantId: DEMO_TENANT_ID },
    adminSession: { userId: DEMO_ADMIN_ID, tenantId: DEMO_TENANT_ID },
    otherSession: { userId: OTHER_USER_ID, tenantId: OTHER_TENANT_ID },
    repository,
    runtime,
    notifications,
    gateway,
    clock,
    tenant,
    workspace,
    organization,
  };
}
