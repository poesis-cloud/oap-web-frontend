import { ADR_INSTRUCTION, ADR_PREFLIGHT, PREFLIGHT_MARKER, changePath, readChange, type OrganizationChange } from '../../core/domain/improvement';
import type { Run } from '../../core/domain/run';
import { DomainError } from '../../core/domain/types';
import { parseArtifact, serializeFrontmatter } from '../../core/saf/frontmatter';
import type { InMemoryWorkspace } from '../workspace-manager/in-memory-workspace';
import type { ScriptedArtifact } from './scripts';

export function prepareChange(repository: InMemoryWorkspace, workspaceId: string, runId: string, inputs: Readonly<Record<string, string>>): OrganizationChange {
  const before = repository.read(workspaceId, ADR_INSTRUCTION);
  if (before === null) throw new DomainError('source-missing', 'The ADR instruction file is not loaded in this workspace.');
  const operation = inputs['operation'] === 'rollback' ? 'rollback' : 'change';
  const painPointPath = inputs['pain-point'] ?? '';
  const pain = repository.read(workspaceId, painPointPath);
  if (operation === 'change' && (!pain || !painPointPath.endsWith('.pain-point.md'))) throw new DomainError('evidence-required', 'Record a pain point before proposing an organization change.');
  if (operation === 'change' && pain && parseArtifact(pain).frontmatter['targetArtifact'] !== ADR_INSTRUCTION) throw new DomainError('unsupported-improvement', 'This demo supports the traced ADR preflight pain point. This pain point needs a different change proposal.');
  if (operation === 'change' && before.includes(PREFLIGHT_MARKER)) throw new DomainError('already-applied', 'The ADR preflight improvement is already applied. Review its scorecard or propose a rollback.');
  let previous: OrganizationChange | null = null;
  if (operation === 'rollback') {
    const candidates = repository.runs(workspaceId).filter(r => r.workflowSlug === 'organization-change' && r.status === 'succeeded').sort((a,b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
    previous = candidates.map(r => readChange(repository.read(workspaceId, changePath(r.id)))).find(c => c?.operation === 'change' && c.after === before) ?? null;
    if (!previous) throw new DomainError('nothing-to-revert', 'No applied organization change matches the current instruction.');
  }
  return { runId, operation, painPointPath: previous?.painPointPath ?? painPointPath, target: ADR_INSTRUCTION, before, after: previous ? previous.before : before + ADR_PREFLIGHT, revertsRunId: previous?.runId ?? null,
    baselineRunIds: repository.runs(workspaceId).filter(r => r.workflowSlug === 'architectural-runway-extension' && r.endedAt).map(r => r.id), intent: inputs['intent'] ?? 'Prevent missing ADR status before the commit gate' };
}

export function changeArtifact(kind: string, change: OrganizationChange, comment: string | null): ScriptedArtifact {
  if (kind === 'organization-change') return { path: changePath(change.runId), content: JSON.stringify(change, null, 2) };
  if (kind === 'change-review') return { path: `improvements/${change.runId}/review.md`, content: `# Change review\n\nFrontend simulation by Quality Engineer.\n\n- Scope: one ADR instruction file; no permissions, schemas or workflow topology changed.\n- Harness validation remains mandatory.\n- The previous bytes are retained for a governed rollback.\n- Approval checks that the live instruction still matches the reviewed baseline.\n\n## Human feedback\n${comment ?? 'No revision requested.'}\n\nThe demo proposes a fixed preflight change. If this diff does not address the feedback, reject or cancel it.\n` };
  return { path: `improvements/${change.runId}/scorecard.md`, content: `# Organization change scorecard\n\n## Baseline\n${change.baselineRunIds.map(id => `- ${id}`).join('\n') || 'No completed comparable runs.'}\n\n## Observation window\nAt least 3 completed Architectural Runway Extension runs started under the applied revision.\n\n## Measures\n- AI cost per accepted artifact (all attempts included)\n- First-pass human acceptance\n- Human gate returns\n- Recurrence of missing ADR status at the commit gate\n\nNo outcome is claimed before the observation window is complete. All usage and prices in this frontend are simulated.\n` };
}

export function captureArtifact(repository: InMemoryWorkspace, run: Run, inputs: Readonly<Record<string,string>>, date: string): ScriptedArtifact {
  const source = repository.runs(run.workspaceId).find(r => r.id === inputs['source-run']);
  const step = source?.steps.find(s => s.stepSlug === inputs['source-step']);
  const rejection = step?.verdicts.find(v => v.fn === 'check-step-artifact' && v.status === 'reverted');
  if (!source || !step || !rejection) throw new DomainError('evidence-missing', 'The selected commit-gate rejection is not in this workspace.');
  const slug = `${source.id}-${step.stepSlug}`;
  const path = `portfolio/art/platform/improvement-backlog/${slug}/${slug}.pain-point.md`;
  const previous = repository.read(run.workspaceId, path);
  if (previous) return { path, content: previous }; // idempotent capture; keep triage and resolution
  const rejectedSession = repository.journal(run.workspaceId).find(e => e.report.context.workflowInstanceId === source.workflowInstanceId && e.report.context.function === 'check-step-artifact' && e.report.outcome.status === 'reverted' && e.timestamp === rejection.at)?.report.context.sessionId ?? step.sessionId;
  const metadata = serializeFrontmatter({ id: `PP-${slug}`, title: 'ADR status missing before the commit gate', status: 'open', origin: 'workflow', layer: 'program', symptom: rejection.detail ?? 'ADR schema validation failed', impact: 'One rejected write and an additional model attempt.', owner: 'release-train-engineer', created: date, sourceRun: source.id, sourceStep: step.stepSlug, sourceSession: rejectedSession, targetArtifact: ADR_INSTRUCTION, evidence: [`runs/${source.id}.run.json`, step.artifactPath ?? ''], resolution: null });
  return { path, content: `${metadata}\n\n# ADR preflight failure\n\nThe harness rejected the write at ${rejection.at}: ${rejection.detail}. The author corrected it and retried.\n\n## Evidence\nRun: ${source.id}. Step: ${step.stepSlug}. The run record retains the verdict and usage of every attempt; the session journal records the rejected write.\n\n## Hypothesis to discuss\nMake required frontmatter checks explicit in the author instruction. Keep the commit gate as the final validator.\n` };
}

export function applyChange(repository: InMemoryWorkspace, run: Run, change: OrganizationChange): Record<string,string> {
  if (repository.read(run.workspaceId, change.target) !== change.before) throw new DomainError('stale-change', 'The instruction changed since this proposal. Cancel this run and prepare a fresh diff; nothing has been applied.');
  const changes: Record<string,string> = { [change.target]: change.after };
  const pain = repository.read(run.workspaceId, change.painPointPath);
  if (pain) {
    const parsed = parseArtifact(pain);
    changes[change.painPointPath] = `${serializeFrontmatter({ ...parsed.frontmatter, status: change.operation === 'rollback' ? 'open' : 'triaged', resolution: change.operation === 'rollback' ? null : 'workflow-improvement', changeRun: run.id })}\n\n${parsed.body}`;
  }
  return changes;
}
