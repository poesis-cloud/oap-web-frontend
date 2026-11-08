import type { WorkspaceStructure } from '../../core/application/workspace-tree';
import type {
  AgentDefinition,
  GateDefinition,
  ItemTypeDefinition,
  ModelProfile,
  OrganizationPackage,
  RoleDefinition,
  WorkflowDefinition,
  WorkflowInput,
} from '../../core/domain/organization';
import agentsJson from '../../../assets/saf-package/agents.json';
import itemTypesJson from '../../../assets/saf-package/item-types.json';
import modelProfilesJson from '../../../assets/saf-package/model-profiles.json';
import packageJson from '../../../assets/saf-package/package.json';
import rolesJson from '../../../assets/saf-package/roles.json';
import workflowsJson from '../../../assets/saf-package/workflows.json';
import workspaceStructureJson from '../../../assets/saf-package/workspace-structure.json';

/**
 * Builds the organization package SAI loads, from fixtures generated out of the real SAF
 * repositories (`tools/import-saf-package.py`). The SAF package declares agents, workflows,
 * steps, capability weights, artifact kinds and the model catalog. What SAF does not declare
 * yet is the "SAI interaction contract" (saf#6 SF15): the Copilot dispatcher, consultation
 * scopes, the ★ gates with their holder roles and the inputs an orchestrator collects. Those
 * are declared below on SAI's side and labelled as such in the UI.
 */

type RawAgent = {
  slug: string;
  name: string;
  kind: 'orchestrator' | 'specialist';
  description: string;
  source: string;
};
type RawWorkflow = Omit<WorkflowDefinition, 'gate' | 'inputs'>;

const SCOPES: Record<string, string> = {
  'release-train-engineer':
    'Program layer: Features, ADRs, PI planning, ART sync, releases. Orchestrates program workflows.',
  'scrum-master': 'Team layer: Stories, iterations, pair programming, verification. Orchestrates team workflows.',
  'value-management-officer':
    'Portfolio layer: Epics, lean business cases, strategic themes. Orchestrates portfolio workflows.',
  'system-architect':
    'Architecture decisions (ADRs), NFRs, runway, enabler Features and Stories. Does not decide ★ gates.',
  'security-expert':
    'Trust boundaries, threat modeling, authn/authz, secrets, compliance risk. Challenge packets only.',
  developer: 'Implementation feasibility, coding, tests, refactors. Challenge packets and code changes.',
  operator: 'Operability: CI/CD, deployment topology, observability, runway. Challenge packets only.',
  'product-manager': 'Business Features and their acceptance criteria (PM hat).',
  'product-owner': 'Business Stories, acceptance criteria, Definition of Ready.',
  'quality-engineer': 'QA acceptance, DoD verification, sign-off artifacts.',
  'business-owner': 'Strategic themes, business Epics, WSJF.',
  'enterprise-architect': 'Portfolio runway, NFR backbone, enabler Epics.',
  'tech-writer': 'Documentation polish for ADRs, Epics, Features and gate packets.',
  'ux-designer': 'User journeys, interaction review, UX challenge packets.',
};

const MAY_CONSULT: Record<string, string[]> = {
  copilot: [
    'system-architect',
    'security-expert',
    'developer',
    'release-train-engineer',
    'scrum-master',
    'value-management-officer',
  ],
  'release-train-engineer': ['system-architect', 'product-manager', 'security-expert'],
  'scrum-master': ['product-owner', 'developer', 'quality-engineer'],
  'system-architect': ['security-expert', 'operator', 'developer'],
};

/** ★ gates after workflows (SAI interaction contract candidate; holder roles from the SAF templates). */
const GATES: Record<string, GateDefinition> = {
  'architectural-runway-extension': {
    slug: 'architecture-gate',
    label: 'Architecture Gate',
    holderRole: 'central-supervisor',
    reviews: 'adr',
    reworkStep: 'author-adr',
  },
  'feature-backlog-refinement': {
    slug: 'feature-gate',
    label: 'Feature Gate',
    holderRole: 'central-supervisor',
    reviews: 'feature',
    reworkStep: 'draft-business',
  },
  'team-backlog-refinement': {
    slug: 'story-gate',
    label: 'Story Gate',
    holderRole: 'product-owner-human',
    reviews: 'story',
    reworkStep: 'draft-business',
  },
};

const INPUTS: Record<string, WorkflowInput[]> = {
  'architectural-runway-extension': [
    { key: 'product', label: 'Product', required: true },
    { key: 'art', label: 'ART', required: true },
    { key: 'feature', label: 'Structurant Feature', required: true },
    { key: 'intent', label: 'Intent', required: true },
  ],
  'feature-backlog-refinement': [
    { key: 'art', label: 'ART', required: true },
    { key: 'intent', label: 'Intent', required: true },
  ],
};

export const COPILOT_AGENT: AgentDefinition = {
  slug: 'copilot',
  name: 'Copilot',
  kind: 'dispatcher',
  description:
    'Default dispatcher of the workspace (SAI interaction contract, SF15). Routes every unaddressed message to the right orchestrator or specialist, or answers out of scope with the closest workflows.',
  scope: 'Dispatch only: no free answers (R15).',
  mayConsult: MAY_CONSULT['copilot'],
};

export function loadSafePackage(): OrganizationPackage {
  const rawAgents = agentsJson as RawAgent[];
  const agents: AgentDefinition[] = [
    COPILOT_AGENT,
    ...rawAgents.map((a) => ({
      ...a,
      scope: SCOPES[a.slug] ?? 'Within the SAFe framework role described above.',
      mayConsult: MAY_CONSULT[a.slug] ?? [],
    })),
  ];
  const workflows: WorkflowDefinition[] = (workflowsJson as RawWorkflow[]).map((w) => ({
    ...w,
    gate: GATES[w.slug],
    inputs: INPUTS[w.slug],
  }));
  const pkg = packageJson as {
    id: string;
    name: string;
    license: string;
    organizationVersion: string;
    harnessVersion: string;
  };
  return {
    id: pkg.id,
    name: pkg.name,
    version: pkg.organizationVersion,
    license: pkg.license,
    harnessVersion: pkg.harnessVersion,
    intendedUse:
      'End-to-end software delivery with SAFe: intent → Epic → Feature → Story → ADR → code → PR → QA evidence, behind the ★ Architecture, PR and Demo gates (first vertical, poesis#40 Q3).',
    limitations: [
      'Gates, Copilot dispatcher, consultation scopes and launch inputs are declared by SAI pending the SAF interaction contract (saf#6 SF15).',
      'The SAFe package is imported as the nominal organization; organization learning (F16) is not part of this slice.',
      'Model profiles come from the SAF catalog; in this build no model is called (mocked agent runtime and model gateway).',
    ],
    dispatcher: 'copilot',
    agents,
    workflows,
    itemTypes: itemTypesJson as ItemTypeDefinition[],
    modelProfiles: modelProfilesJson as ModelProfile[],
    workspaceStructure: workspaceStructureJson as WorkspaceStructure,
    roles: rolesJson as RoleDefinition[],
  };
}
