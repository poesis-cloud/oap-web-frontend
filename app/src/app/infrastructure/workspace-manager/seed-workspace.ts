import type { Clock, WorkspaceRepository } from '../../core/ports';
import type { OrganizationPackage } from '../../core/domain/organization';
import type { Workspace } from '../../core/domain/workspace';
import { serializeFrontmatter } from '../../core/saf/frontmatter';
import type { InMemoryWorkspace } from './in-memory-workspace';
import type { OrganizationSources } from './organization-sources';

/**
 * Seeds one hosted SAF workspace: the nominal import of the organization package as one tagged
 * commit (F14-R7) and, for the demonstration workspace, a small SAFe backlog laid out as the
 * organization's workspace structure map declares (`conf/workspace.conf.yaml`). All names are
 * invented; no real customer, user or credential appears.
 */
export interface WorkspaceSeed {
  id: string;
  tenantId: string;
  name: string;
  repository: string;
  organization: OrganizationPackage;
  /** The organization files to import under `organization/` (F16-R1); the manifest alone when absent. */
  sources?: OrganizationSources | null;
  withBacklog: boolean;
}

export function seedWorkspace(
  repository: InMemoryWorkspace,
  workspaces: WorkspaceRepository,
  clock: Clock,
  spec: WorkspaceSeed,
): Workspace {
  repository.init(spec.id);
  const importedAt = clock.now();
  const manifest = {
    package: spec.organization.id,
    version: spec.organization.version,
    harness: spec.organization.harnessVersion,
    license: spec.organization.license,
    importedAt,
    agents: spec.organization.agents.filter((a) => a.kind !== 'dispatcher').map((a) => a.slug),
    workflows: spec.organization.workflows.map((w) => w.slug),
    sourceFiles: spec.sources ? Object.keys(spec.sources.files).length : 0,
  };
  const sources: Record<string, string> = {};
  for (const [path, content] of Object.entries(spec.sources?.files ?? {})) sources[`organization/${path}`] = content;
  const nominal = repository.commit({
    workspaceId: spec.id,
    message: `nominal import: ${spec.organization.id}@${spec.organization.version}`,
    sessionId: null,
    runId: null,
    stepSlug: null,
    author: { kind: 'installer' },
    changes: {
      ...sources,
      'organization/package.json': JSON.stringify(manifest, null, 2),
      'organization/README.md': `# Organization of this workspace\n\nNominal state imported from \`${spec.organization.id}\` ${spec.organization.version} (${spec.organization.license}): ${Object.keys(sources).length} files under \`organization/\` (agents, workflows, skills, instructions, artifact schemas and templates, configuration).\n\nIt changes only through governed \`organization-change\` and \`organization-upgrade\` runs (oap#1 F16, SAF SF11 and SF13), never by hand. This build does not run them yet.\n`,
    },
    tag: `nominal-import/${spec.organization.id}@${spec.organization.version}`,
    timestamp: importedAt,
  });
  if (spec.withBacklog) {
    const date = importedAt.slice(0, 10);
    repository.commit({
      workspaceId: spec.id,
      message: 'seed: product and ART manifests (installer, demonstration data)',
      sessionId: null,
      runId: null,
      stepSlug: null,
      author: { kind: 'installer' },
      changes: {
        'products/customer-platform/product-manifest.yaml': `slug: customer-platform\nname: Customer Platform\nrepos:\n  - customer-platform-api\n  - platform-gateway\nowner: SE-Product-Manager\n`,
        'products/customer-platform/product-vision.md': `---\nproduct: customer-platform\nrevised: ${date}\n---\n\n# Customer Platform — Product Vision\n\nOne platform for subscriptions, invoicing and partner integrations, operated for European customers with strict tenant isolation.\n\n## Horizon\n- Subscriptions API opened to partners\n- Invoicing export\n- Self-service portal\n`,
        'art/platform/art-manifest.yaml': `slug: platform\nname: Platform ART\nteams:\n  - api-team\n  - portal-team\nproducts:\n  - customer-platform\n`,
      },
      timestamp: clock.now(),
    });
    repository.commit({
      workspaceId: spec.id,
      message: 'seed: program backlog (installer, demonstration data)',
      sessionId: null,
      runId: null,
      stepSlug: null,
      author: { kind: 'installer' },
      changes: {
        'art/platform/program-backlog/customer-subscriptions-api/customer-subscriptions-api.feature.md': feature({
          id: 'F-12',
          title: 'Secure REST API for customer subscriptions',
          status: 'arch-pending',
          structurant: true,
          date,
          description:
            'Expose customer subscriptions (create, change, cancel, read) to partner applications and to the customer portal through a REST API, with strict tenant isolation and GDPR-compliant handling of billing contacts.',
          criteria: [
            'AC1. Given a partner token bound to tenant A, when it reads a subscription of tenant B, then the API answers 404 and records an audit event.',
            'AC2. Given a valid Idempotency-Key, when the same POST is replayed, then exactly one subscription exists.',
            'AC3. The API must expose export and erasure of billing-contact data within 30 days of a request.',
          ],
        }),
        'art/platform/program-backlog/subscription-invoicing-export/subscription-invoicing-export.feature.md': feature({
          id: 'F-13',
          title: 'Subscription invoicing export',
          status: 'refined',
          structurant: false,
          date,
          description:
            'Monthly export of subscription changes to the invoicing system, per tenant, with reconciliation report.',
          criteria: [
            'AC1. Given a closed month, when the export runs, then every subscription change of the month appears exactly once.',
          ],
        }),
        'art/platform/program-backlog/partner-sandbox/partner-sandbox.feature.md': feature({
          id: 'F-15',
          title: 'Partner sandbox environment',
          status: 'funnel',
          structurant: false,
          date,
          description: 'A sandbox where partners try the subscriptions API with synthetic data before going live.',
          criteria: ['AC1. A partner can obtain sandbox credentials without a support ticket.'],
        }),
        'art/platform/teams/api-team/team-backlog/subscription-read-endpoint/subscription-read-endpoint.story.md':
          story({
            id: 'S-41',
            title: 'Read a subscription by id',
            status: 'in-progress',
            date,
          }),
        'art/platform/teams/api-team/team-backlog/idempotency-key-store/idempotency-key-store.story.md': story({
          id: 'S-42',
          title: 'Idempotency-Key store with 24 h TTL',
          status: 'ready',
          date,
        }),
      },
      timestamp: clock.now(),
    });
  }
  const workspace: Workspace = {
    id: spec.id,
    tenantId: spec.tenantId,
    name: spec.name,
    repository: spec.repository,
    organizationPackage: { id: spec.organization.id, version: spec.organization.version },
    nominalImportCommit: nominal.sha,
    status: 'active',
    createdAt: importedAt,
  };
  workspaces.save(workspace);
  return workspace;
}

function feature(spec: {
  id: string;
  title: string;
  status: string;
  structurant: boolean;
  date: string;
  description: string;
  criteria: string[];
}): string {
  const frontmatter = serializeFrontmatter({
    id: spec.id,
    title: spec.title,
    status: spec.status,
    type: 'business',
    parentEpic: null,
    epicRationale: 'standalone: platform opening to partners',
    structurant: spec.structurant,
    risk: spec.structurant ? 'critical' : 'medium',
    complexity: spec.structurant ? 'complex' : 'involved',
    architectureInventory: null,
    adrs: [],
    owner: 'SE-Product-Manager',
    created: spec.date,
    openItems: [],
  });
  return `${frontmatter}\n\n# ${spec.id} — ${spec.title}\n\n## Description\n${spec.description}\n\n## Acceptance criteria\n${spec.criteria.map((c) => `- ${c}`).join('\n')}\n`;
}

function story(spec: { id: string; title: string; status: string; date: string }): string {
  const frontmatter = serializeFrontmatter({
    id: spec.id,
    title: spec.title,
    status: spec.status,
    type: 'user',
    parentFeature: 'F-12',
    owner: 'SE-Product-Owner',
    created: spec.date,
  });
  return `${frontmatter}\n\n# ${spec.id} — ${spec.title}\n\n## Acceptance Criteria\n- AC1. Given a valid token, when the endpoint is called, then the subscription of the token's tenant is returned.\n`;
}
