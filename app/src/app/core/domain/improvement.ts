import type { WorkflowDefinition } from './organization';

/** Frontend contract candidate for SAF SF11, not an upstream package workflow. */
export const ORGANIZATION_CHANGE_WORKFLOW: WorkflowDefinition = {
  slug: 'organization-change',
  layer: 'program',
  description: 'Frontend simulation: draft an instruction change, challenge it, review its scorecard, then decide at the Organization gate. Rollback follows the same workflow.',
  orchestrator: 'release-train-engineer',
  predecessors: ['improvement-backlog'],
  steps: [
    { slug: 'draft-change', actor: 'system-architect', artifact: 'organization-change', description: 'Propose a bounded instruction diff with pain-point evidence.', capabilities: { 'deep-reasoning': 8, 'writing-quality': 7 }, conditions: [], instructions: [], skills: [] },
    { slug: 'challenge-change', actor: 'quality-engineer', artifact: 'change-review', description: 'Check the proposed diff, its scope and rollback preconditions.', capabilities: { 'deep-reasoning': 7 }, conditions: [{ slug: 'after-draft', kind: 'precondition', step: 'draft-change' }], instructions: [], skills: [] },
    { slug: 'change-scorecard', actor: 'release-train-engineer', artifact: 'change-scorecard', description: 'Record the baseline and the observation window. Do not claim an unmeasured improvement.', capabilities: { 'writing-quality': 6 }, conditions: [{ slug: 'after-review', kind: 'precondition', step: 'challenge-change' }], instructions: [], skills: [] },
  ],
  gate: { slug: 'organization-gate', label: 'Organization Gate', holderRole: 'central-supervisor', reviews: 'organization-change', reworkStep: 'draft-change' },
  inputs: [{ key: 'intent', label: 'Improvement intent', required: true }],
};

export const ADR_INSTRUCTION = 'organization/instructions/system-architect/program-architectural-runway-extension-author-adr.instructions.md';
export const PREFLIGHT_MARKER = '<!-- oap-demo:adr-preflight -->';
export const ADR_PREFLIGHT = `\n\n${PREFLIGHT_MARKER}\n## ADR preflight\n\nBefore submitting the ADR, check that frontmatter includes a valid status (proposed), and that the required schema fields are present. If a field is missing, correct it before invoking the commit gate. Never bypass the harness validation.\n`;

export interface OrganizationChange {
  readonly runId: string;
  readonly operation: 'change' | 'rollback';
  readonly painPointPath: string;
  readonly target: string;
  readonly before: string;
  readonly after: string;
  readonly revertsRunId: string | null;
  readonly baselineRunIds: readonly string[];
  readonly intent: string;
}

export const changePath = (runId: string) => `improvements/${runId}/organization-change.json`;

export function readChange(content: string | null): OrganizationChange | null {
  if (!content) return null;
  try {
    const value = JSON.parse(content) as OrganizationChange;
    return value.target === ADR_INSTRUCTION && typeof value.before === 'string' && typeof value.after === 'string' && Array.isArray(value.baselineRunIds) ? value : null;
  } catch { return null; }
}
