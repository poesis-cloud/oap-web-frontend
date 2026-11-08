import type { WorkspaceStructure } from '../application/workspace-tree';
import type { AgentSlug } from './types';

/**
 * The organization loaded in a workspace, as SAI reads it from the SAF package.
 *
 * SAI hard-codes no business concept (affordance R18): agents, workflows, item types,
 * statuses, gates and labels all come from here. The SAFe agentic organization is the
 * reference organization, not a dependency. The "SAI interaction contract" fields
 * (dispatcher, gates, consultation scopes) are not yet declared by SAF (saf#6 SF15): the
 * demo package declares them on SAI's side and labels them as such.
 */

export type CapabilityTag =
  | 'deep-reasoning'
  | 'coding'
  | 'tool-use'
  | 'long-context'
  | 'multimodal'
  | 'writing-quality'
  | 'instruction-following'
  | 'fast-iteration'
  | 'schema-adherence';

export const CAPABILITY_TAGS: readonly CapabilityTag[] = [
  'deep-reasoning',
  'coding',
  'tool-use',
  'long-context',
  'multimodal',
  'writing-quality',
  'instruction-following',
  'fast-iteration',
  'schema-adherence',
];

export type CapabilityWeights = Readonly<Partial<Record<CapabilityTag, number>>>;

export type OrganizationLayer = 'portfolio' | 'program' | 'team';

export interface AgentDefinition {
  readonly slug: AgentSlug;
  readonly name: string;
  readonly kind: 'dispatcher' | 'orchestrator' | 'specialist';
  readonly description: string;
  /** The consultation scope the agent answers within, outside runs (F1-R10, SF15). */
  readonly scope?: string;
  /** Agents this agent may consult or delegate to through child threads (F4-R12). */
  readonly mayConsult?: readonly AgentSlug[];
  readonly source?: string;
}

export interface StepCondition {
  readonly slug: string;
  readonly kind: 'precondition';
  readonly step: string;
}

export interface StepDefinition {
  readonly slug: string;
  readonly description: string;
  readonly actor: AgentSlug;
  /** The artifact kind (schema slug) the step delivers: 1 step = 1 agent = 1 session = 1 artifact. */
  readonly artifact: string;
  readonly capabilities: CapabilityWeights;
  readonly conditions: readonly StepCondition[];
  readonly instructions: readonly string[];
  readonly skills: readonly string[];
}

/** A human ★ gate declared by the organization after a workflow (SF15 candidate). */
export interface GateDefinition {
  readonly slug: string;
  readonly label: string;
  /** The organization-declared role whose holders may decide the gate (F4-R3). */
  readonly holderRole: string;
  /** Artifact kind presented for review at the gate. */
  readonly reviews: string;
  /** Step the workflow reroutes to on rejection (rework), as the organization declares. */
  readonly reworkStep: string;
}

export interface WorkflowInput {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

export interface WorkflowDefinition {
  readonly slug: string;
  readonly layer: OrganizationLayer;
  readonly description: string;
  readonly orchestrator: AgentSlug;
  readonly predecessors: readonly string[];
  readonly steps: readonly StepDefinition[];
  readonly gate?: GateDefinition;
  readonly inputs?: readonly WorkflowInput[];
  readonly source?: string;
}

export interface ItemTypeDefinition {
  readonly slug: string;
  readonly label: string;
  readonly pathPatterns: readonly string[];
  readonly statuses: readonly string[];
  readonly source?: string;
}

export interface ModelProfile {
  readonly slug: string;
  readonly costRank: number;
  readonly description: string;
  readonly capabilities: CapabilityWeights;
}

export interface OrganizationPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly harnessVersion: string;
  readonly intendedUse: string;
  readonly limitations: readonly string[];
  /** The Copilot dispatcher agent (F1-R9, SF15). */
  readonly dispatcher: AgentSlug;
  readonly agents: readonly AgentDefinition[];
  readonly workflows: readonly WorkflowDefinition[];
  /** Trackable item types and their lifecycle statuses (F5-R2). */
  readonly itemTypes: readonly ItemTypeDefinition[];
  readonly modelProfiles: readonly ModelProfile[];
  /** The workspace structure map the organization declares (`conf/workspace.conf.yaml`). */
  readonly workspaceStructure: WorkspaceStructure;
  /** Roles of the access-control list and the artifact kinds each may write. */
  readonly roles: readonly RoleDefinition[];
}

export interface RoleDefinition {
  readonly slug: string;
  readonly artifacts: readonly string[];
}

export function findAgent(pkg: OrganizationPackage, slug: AgentSlug): AgentDefinition | undefined {
  return pkg.agents.find((a) => a.slug === slug);
}

export function findWorkflow(pkg: OrganizationPackage, slug: string): WorkflowDefinition | undefined {
  return pkg.workflows.find((w) => w.slug === slug);
}

export function findStep(workflow: WorkflowDefinition, slug: string): StepDefinition | undefined {
  return workflow.steps.find((s) => s.slug === slug);
}

/** Matches an artifact path against the item types' glob-like patterns (`*` = one segment). */
export function itemTypeForPath(pkg: OrganizationPackage, path: string): ItemTypeDefinition | undefined {
  return pkg.itemTypes.find((type) => type.pathPatterns.some((pattern) => matchPathPattern(pattern, path)));
}

export function matchPathPattern(pattern: string, path: string): boolean {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`).test(path);
}
