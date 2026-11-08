import type {
  Clock,
  DecideGateCommand,
  IdMinter,
  LaunchCommand,
  RuntimeEvent,
  RuntimePort,
  UsageLedger,
} from '../../core/ports';
import { GATE_TRANSITIONS, RUN_TRANSITIONS, transition } from '../../core/domain/lifecycles';
import {
  findStep,
  findWorkflow,
  type OrganizationPackage,
  type StepDefinition,
  type WorkflowDefinition,
} from '../../core/domain/organization';
import { runTokens, type Gate, type ModelRoute, type Run, type StepRun } from '../../core/domain/run';
import {
  Actor,
  DomainError,
  type ActorRef,
  type RunId,
  type TenantId,
  type WorkspaceId,
} from '../../core/domain/types';
import { mintWorkflowInstanceId, type HarnessFunction, type JournalEntry, type Report } from '../../core/saf/contracts';
import { parseArtifact, serializeFrontmatter } from '../../core/saf/frontmatter';
import { resolveModelProfile } from '../../core/saf/model-resolution';
import { ADR_ID, STEP_TOKENS, painPoint, scriptedArtifact, type ScriptContext } from './scripts';
import type { InMemoryWorkspace } from '../workspace-manager/in-memory-workspace';

/**
 * Deterministic demo runtime: the `RuntimePort` implementation of this build.
 *
 * It is NOT an autonomous agent system and calls no model. It replays the SAF harness
 * lifecycle over the real SAFe organization package — session start, step resolution,
 * model resolution by the harness rule, precondition check, authorization, commit gate,
 * postcondition check, session end — writing journal entries in the harness log-entry
 * contract and committing artifacts to the in-memory workspace, one validated write per
 * commit. Artifact bodies are scripted (`scripts.ts`). In production this port is served by
 * `oap-agent-runtime` running the SAF harness behind the SAI host adapter (saf#6 SF1).
 */

interface Cursor {
  readonly organization: OrganizationPackage;
  readonly workflow: WorkflowDefinition;
  readonly context: ScriptContext;
  /** Steps whose first write was already reverted once (to showcase the commit gate once). */
  readonly revertedOnce: Set<string>;
  tenantId: TenantId;
  alerted: boolean;
}

const BUDGET_ALERT_RATIO = 0.8;

export class MockAgentRuntime implements RuntimePort {
  private readonly runs = new Map<RunId, Run>();
  private readonly cursors = new Map<RunId, Cursor>();
  private instanceSeed = 1;

  constructor(
    private readonly repository: InMemoryWorkspace,
    private readonly usage: UsageLedger,
    private readonly clock: Clock,
    private readonly ids: IdMinter,
    private readonly tenantOf: (workspaceId: WorkspaceId) => TenantId,
  ) {}

  run(runId: RunId): Run | undefined {
    return this.runs.get(runId);
  }

  /** Reload runs from a workspace (the workspace is the system of record, F14-R4). */
  hydrate(workspaceId: WorkspaceId): void {
    for (const run of this.repository.runs(workspaceId)) this.runs.set(run.id, run);
  }

  launch(command: LaunchCommand): Run {
    const workflow = findWorkflow(command.organization, command.proposal.workflowSlug);
    if (!workflow)
      throw new DomainError('unknown-workflow', `Workflow ${command.proposal.workflowSlug} is not in the organization`);
    const organizationCommit = this.repository.head(command.workspace.id);
    if (!organizationCommit) throw new DomainError('workspace-empty', 'The workspace has no nominal import commit');
    const now = this.clock.now();
    const runId = this.ids.mint('run');
    const orchestratorSessionId = this.ids.mint('sess');
    const inputs = command.proposal.inputs;
    const featureSlug = inputs['feature-slug'] ?? 'customer-subscriptions-api';
    const run: Run = {
      id: runId,
      workspaceId: command.workspace.id,
      conversationId: command.conversationId,
      proposalId: command.proposal.id,
      workflowSlug: workflow.slug,
      workflowInstanceId: mintWorkflowInstanceId(workflow.slug, this.instanceSeed++ * 7919 + 1024),
      orchestratorSessionId,
      launchedBy: command.launchedBy,
      organizationCommit,
      status: 'queued',
      steps: workflow.steps.map((step) => pendingStep(step, 1)),
      gates: [],
      budget: { limitTokens: command.budgetLimitTokens },
      startedAt: now,
      endedAt: null,
      failure: null,
      partialArtifacts: [],
    };
    this.cursors.set(runId, {
      organization: command.organization,
      workflow,
      context: {
        product: inputs['product'] ?? 'customer-platform',
        art: inputs['art'] ?? 'platform',
        featureSlug,
        featureId: inputs['feature'] ?? 'F-12',
        featureTitle: inputs['feature-title'] ?? 'Secure REST API for customer subscriptions',
        intent: inputs['intent'] ?? 'Design a secure REST API for customer subscriptions',
        date: now.slice(0, 10),
        revision: 1,
        gateComment: null,
      },
      revertedOnce: new Set(),
      tenantId: this.tenantOf(command.workspace.id),
      alerted: false,
    });
    this.persist(run, 'run created from a confirmed launch proposal');
    return run;
  }

  advance(runId: RunId): { run: Run; events: readonly RuntimeEvent[] } {
    let run = this.require(runId);
    const cursor = this.cursor(runId);
    const events: RuntimeEvent[] = [];
    const now = this.clock.now();

    if (run.status === 'queued') {
      run = { ...run, status: transition('run', RUN_TRANSITIONS, run.status, 'running') };
      this.journal(
        run,
        'start-session',
        run.orchestratorSessionId,
        null,
        { status: 'started' },
        { agent: cursor.workflow.orchestrator },
      );
      this.journal(run, 'resolve-workflow-instructions', run.orchestratorSessionId, null, { status: 'resolved' });
      this.journal(run, 'resolve-workflow-skills', run.orchestratorSessionId, null, { status: 'resolved' });
      this.persist(run, 'run started');
      events.push({ kind: 'run-started', runId, at: now });
      return { run, events };
    }
    if (run.status !== 'running') return { run, events };

    const next = this.nextStep(run, cursor.workflow);
    if (!next) {
      // Every authored step has a passing journaled execution: the harness observes no next step.
      this.journal(run, 'resolve-step', run.orchestratorSessionId, null, { status: 'no-next-step' });
      const gateDefinition = cursor.workflow.gate;
      if (!gateDefinition) {
        this.journal(run, 'end-session', run.orchestratorSessionId, null, { status: 'ended' });
        run = this.end(run, 'succeeded', null);
        this.persist(run, 'run succeeded (no gate declared)');
        events.push({ kind: 'run-ended', runId, status: run.status, at: now });
        return { run, events };
      }
      const reviewed = run.steps.find(
        (s) => s.status === 'delivered' && findStep(cursor.workflow, s.stepSlug)?.artifact === gateDefinition.reviews,
      );
      const gate: Gate = {
        id: this.ids.mint('gate'),
        runId,
        slug: gateDefinition.slug,
        label: gateDefinition.label,
        holderRole: gateDefinition.holderRole,
        artifactPath: reviewed?.artifactPath ?? run.steps.find((s) => s.artifactPath)?.artifactPath ?? '',
        status: 'pending',
        raisedAt: now,
        decidedBy: null,
        decidedAt: null,
        comment: null,
        reviewerSeconds: null,
      };
      run = {
        ...run,
        status: transition('run', RUN_TRANSITIONS, run.status, 'waiting-for-gate'),
        gates: [...run.gates, gate],
      };
      this.persist(run, `★ ${gate.label} raised`);
      events.push({ kind: 'gate-raised', runId, gate, at: now });
      return { run, events };
    }

    const [index, stepRun] = next;
    const step = findStep(cursor.workflow, stepRun.stepSlug) as StepDefinition;
    if (stepRun.status === 'pending') {
      // Resolution (orchestrator session), then the step session opens with its context.
      const profile = resolveModelProfile(step.capabilities, cursor.organization.modelProfiles);
      this.journal(
        run,
        'resolve-step',
        run.orchestratorSessionId,
        null,
        { status: 'step-resolution' },
        {
          step: {
            slug: step.slug,
            actor: step.actor,
            artifact: step.artifact,
            skills: step.skills,
            instructions: step.instructions,
            capabilities: step.capabilities as Record<string, number>,
            conditions: step.conditions,
            description: step.description,
          },
        },
      );
      this.journal(run, 'resolve-step-model', run.orchestratorSessionId, null, { status: 'resolved' }, { profile });
      const sessionId = this.ids.mint('sess');
      this.journal(
        run,
        'start-session',
        sessionId,
        run.orchestratorSessionId,
        { status: 'started' },
        { agent: step.actor },
      );
      this.journal(
        run,
        'check-step-preconditions',
        sessionId,
        run.orchestratorSessionId,
        { status: 'pass' },
        { conditionChecks: [] },
      );
      this.journal(run, 'resolve-step-instructions', sessionId, run.orchestratorSessionId, { status: 'resolved' });
      this.journal(run, 'resolve-step-skills', sessionId, run.orchestratorSessionId, { status: 'resolved' });
      const model: ModelRoute = {
        profile: profile.slug,
        score: profile.score,
        costRank: profile.costRank,
        reason: profile.reason,
        hostModel: null,
      };
      const started: StepRun = {
        ...stepRun,
        status: 'running',
        sessionId,
        model,
        startedAt: now,
        verdicts: [
          ...stepRun.verdicts,
          { fn: 'resolve-step', status: 'step-resolution', at: now },
          {
            fn: 'resolve-step-model',
            status: 'resolved',
            at: now,
            detail: `${profile.slug} (score ${profile.score}, cost rank ${profile.costRank})`,
          },
          { fn: 'check-step-preconditions', status: 'pass', at: now },
        ],
      };
      run = this.replaceStep(run, index, started);
      this.persist(run, `step ${step.slug} dispatched to ${step.actor}`);
      events.push({ kind: 'step-started', runId, stepSlug: step.slug, actor: step.actor, at: now });
      return { run, events };
    }

    // The write boundary: authorization, then the commit gate validates the staged bytes.
    const firstAdrAttempt =
      step.artifact === 'adr' && cursor.context.revision === 1 && !cursor.revertedOnce.has(step.slug);
    const artifact = scriptedArtifact(step.artifact, cursor.context, !firstAdrAttempt);
    const tokens = STEP_TOKENS[step.slug] ?? { input: 3000, output: 600 };
    this.journal(run, 'check-step-authorization', stepRun.sessionId, run.orchestratorSessionId, { status: 'allowed' });
    const parsed = parseArtifact(artifact.content);
    const requiredMissing = step.artifact === 'adr' && typeof parsed.frontmatter['status'] !== 'string';
    if (requiredMissing) {
      cursor.revertedOnce.add(step.slug);
      const reason = `frontmatter.status: required property missing (schema ${step.artifact})`;
      this.journal(
        run,
        'check-step-artifact',
        stepRun.sessionId,
        run.orchestratorSessionId,
        { status: 'reverted' },
        {
          artifactChecks: [{ artifactPath: artifact.path, failureMessage: reason, revert: { action: 'deleted' } }],
        },
      );
      const reverted: StepRun = {
        ...stepRun,
        tokens: {
          input: stepRun.tokens.input + tokens.input,
          output: stepRun.tokens.output + Math.round(tokens.output / 2),
        },
        verdicts: [...stepRun.verdicts, { fn: 'check-step-artifact', status: 'reverted', at: now, detail: reason }],
        challengeRounds: stepRun.challengeRounds,
      };
      run = this.replaceStep(run, index, reverted);
      this.recordUsage(run, reverted, cursor, tokens.input, Math.round(tokens.output / 2));
      this.persist(run, `commit gate reverted ${artifact.path}`);
      events.push({ kind: 'commit-gate-reverted', runId, stepSlug: step.slug, reason, at: now });
      return { run, events };
    }

    const commit = this.repository.commit({
      workspaceId: run.workspaceId,
      message: `${step.artifact}: ${step.slug} [session ${stepRun.sessionId}] [run ${run.id}]`,
      sessionId: stepRun.sessionId,
      runId: run.id,
      stepSlug: step.slug,
      author: Actor.agent(step.actor),
      changes: { [artifact.path]: artifact.content },
      timestamp: now,
    });
    this.journal(run, 'check-step-artifact', stepRun.sessionId, run.orchestratorSessionId, { status: 'valid' });
    this.journal(
      run,
      'check-step-postconditions',
      stepRun.sessionId,
      run.orchestratorSessionId,
      { status: 'pass' },
      { conditionChecks: [] },
    );
    this.journal(run, 'end-session', stepRun.sessionId, run.orchestratorSessionId, { status: 'ended' });
    const delivered: StepRun = {
      ...stepRun,
      status: 'delivered',
      artifactPath: artifact.path,
      commitSha: commit.sha,
      tokens: { input: stepRun.tokens.input + tokens.input, output: stepRun.tokens.output + tokens.output },
      challengeRounds: step.slug.startsWith('challenge') ? 1 : stepRun.challengeRounds,
      endedAt: now,
      verdicts: [
        ...stepRun.verdicts,
        { fn: 'check-step-authorization', status: 'allowed', at: now },
        { fn: 'check-step-artifact', status: 'valid', at: now, detail: `commit ${commit.sha.slice(0, 7)}` },
        { fn: 'check-step-postconditions', status: 'pass', at: now },
        { fn: 'end-session', status: 'ended', at: now },
      ],
    };
    run = this.replaceStep(run, index, delivered);
    this.recordUsage(run, delivered, cursor, tokens.input, tokens.output);
    events.push({ kind: 'step-delivered', runId, stepSlug: step.slug, artifactPath: artifact.path, at: now });

    const used = runTokens(run).total;
    if (used > run.budget.limitTokens) {
      this.journal(run, 'end-session', run.orchestratorSessionId, null, { status: 'ended' });
      run = this.end(run, 'failed', {
        code: 'budget',
        message: `budget of ${run.budget.limitTokens} tokens exceeded (${used})`,
      });
      this.persist(run, 'run failed: budget exceeded');
      events.push({ kind: 'run-ended', runId, status: run.status, at: now });
      return { run, events };
    }
    if (!cursor.alerted && used >= run.budget.limitTokens * BUDGET_ALERT_RATIO) {
      cursor.alerted = true;
      events.push({ kind: 'budget-alert', runId, usedTokens: used, limitTokens: run.budget.limitTokens, at: now });
    }
    this.persist(run, `step ${step.slug} delivered ${artifact.path}`);
    return { run, events };
  }

  decideGate(command: DecideGateCommand): { run: Run; events: readonly RuntimeEvent[] } {
    let run = this.require(command.runId);
    const cursor = this.cursor(command.runId);
    const gate = run.gates.find((g) => g.id === command.gateId);
    if (!gate) throw new DomainError('gate-missing', 'Gate not found');
    const now = this.clock.now();
    const status = transition('gate', GATE_TRANSITIONS, gate.status, command.decision);
    const decided: Gate = {
      ...gate,
      status,
      decidedBy: command.decidedBy,
      decidedAt: now,
      comment: command.comment,
      reviewerSeconds: command.reviewerSeconds,
    };
    run = { ...run, gates: run.gates.map((g) => (g.id === gate.id ? decided : g)) };
    const events: RuntimeEvent[] = [{ kind: 'gate-decided', runId: run.id, gate: decided, at: now }];
    const decisionSession = this.ids.mint('gate-sess');

    if (command.decision === 'rejected') {
      // Reroute to rework as the organization declares: the reworked steps get new sessions.
      const reworkSlug = cursor.workflow.gate?.reworkStep ?? run.steps[0].stepSlug;
      const reworkIndex = Math.max(
        0,
        cursor.workflow.steps.findIndex((s) => s.slug === reworkSlug),
      );
      // Reworked steps start again with a new attempt and a new session, but the cost and the
      // verdicts of their previous attempts stay on the run: cost per accepted artifact counts
      // every model call the acceptance took (R14, F4-R10).
      const steps = run.steps.map((s, i) =>
        i >= reworkIndex
          ? {
              ...pendingStep(findStep(cursor.workflow, s.stepSlug) as StepDefinition, s.attempt + 1),
              tokens: s.tokens,
              verdicts: s.verdicts,
              challengeRounds: s.challengeRounds,
            }
          : s,
      );
      const context: ScriptContext = {
        ...cursor.context,
        revision: cursor.context.revision + 1,
        gateComment: command.comment,
      };
      this.cursors.set(run.id, { ...cursor, context, revertedOnce: cursor.revertedOnce });
      run = { ...run, status: transition('run', RUN_TRANSITIONS, run.status, 'running'), steps };
      this.persist(run, `★ ${gate.label} rejected; rework from ${reworkSlug}`, command.decidedBy, decisionSession);
      return { run, events };
    }

    // Acceptance is a validated write: the reviewed artifact and the item it serves change status.
    const changes: Record<string, string> = {};
    const adrPath = decided.artifactPath;
    const adrContent = this.repository.read(run.workspaceId, adrPath);
    if (adrContent) changes[adrPath] = setFrontmatter(adrContent, { status: 'accepted', decided: now.slice(0, 10) });
    const featurePath = `art/${cursor.context.art}/program-backlog/${cursor.context.featureSlug}/${cursor.context.featureSlug}.feature.md`;
    const featureContent = this.repository.read(run.workspaceId, featurePath);
    if (featureContent) {
      const parsed = parseArtifact(featureContent);
      const nextStatus =
        parsed.frontmatter['status'] === 'arch-pending' ? 'ready' : (parsed.frontmatter['status'] as string);
      changes[featurePath] = setFrontmatter(featureContent, {
        status: nextStatus,
        adrs: [ADR_ID],
        architectureInventory: adrPath,
      });
    }
    if (command.decision === 'approved-with-reservation' && command.comment) {
      const pain = painPoint(cursor.context, command.comment, run.id, gate.label);
      changes[pain.path] = pain.content;
    }
    if (Object.keys(changes).length > 0) {
      this.repository.commit({
        workspaceId: run.workspaceId,
        message: `gate ${gate.slug}: ${command.decision} [session ${decisionSession}] [run ${run.id}]`,
        sessionId: decisionSession,
        runId: run.id,
        stepSlug: null,
        author: command.decidedBy,
        changes,
        timestamp: now,
      });
    }
    this.journal(run, 'end-session', run.orchestratorSessionId, null, { status: 'ended' });
    run = this.end(run, 'succeeded', null);
    this.persist(run, `★ ${gate.label} ${command.decision}; run succeeded`, command.decidedBy, decisionSession);
    events.push({ kind: 'run-ended', runId: run.id, status: run.status, at: now });
    return { run, events };
  }

  cancel(runId: RunId, by: ActorRef): { run: Run; events: readonly RuntimeEvent[] } {
    let run = this.require(runId);
    const now = this.clock.now();
    const partial = run.steps
      .filter((s) => s.status === 'delivered' && s.artifactPath)
      .map((s) => s.artifactPath as string);
    const steps = run.steps.map((s) =>
      s.status === 'running' || s.status === 'pending'
        ? { ...s, status: 'cancelled' as const, endedAt: s.status === 'running' ? now : s.endedAt }
        : s,
    );
    for (const step of run.steps) {
      if (step.status === 'running') {
        this.journal(run, 'end-session', step.sessionId, run.orchestratorSessionId, { status: 'ended' });
      }
    }
    this.journal(run, 'end-session', run.orchestratorSessionId, null, { status: 'ended' });
    run = this.end(
      {
        ...run,
        steps,
        partialArtifacts: partial,
        gates: run.gates.map((g) => (g.status === 'pending' ? { ...g, status: 'expired' as const } : g)),
      },
      'cancelled',
      {
        code: 'cancelled',
        message: `cancelled by ${by.kind === 'human' ? by.userId : by.slug}`,
      },
    );
    this.persist(run, 'run cancelled; partial artifacts kept', by);
    return { run, events: [{ kind: 'run-ended', runId, status: run.status, at: now }] };
  }

  // ------------------------------------------------------------------ internals

  private nextStep(run: Run, workflow: WorkflowDefinition): [number, StepRun] | null {
    for (let i = 0; i < run.steps.length; i += 1) {
      const stepRun = run.steps[i];
      if (stepRun.status === 'delivered') continue;
      const step = findStep(workflow, stepRun.stepSlug) as StepDefinition;
      const ready = step.conditions.every((c) => run.steps.find((s) => s.stepSlug === c.step)?.status === 'delivered');
      if (ready) return [i, stepRun];
    }
    return null;
  }

  private replaceStep(run: Run, index: number, step: StepRun): Run {
    return { ...run, steps: run.steps.map((s, i) => (i === index ? step : s)) };
  }

  private end(run: Run, status: 'succeeded' | 'failed' | 'cancelled', failure: Run['failure']): Run {
    const next = transition('run', RUN_TRANSITIONS, run.status, status);
    const updated: Run = { ...run, status: next, endedAt: this.clock.now(), failure };
    this.cursors.get(run.id);
    return updated;
  }

  private journal(
    run: Run,
    fn: HarnessFunction,
    sessionId: string,
    parentSessionId: string | null,
    outcome: Report['outcome'],
    extra: Partial<Report> = {},
  ): void {
    const entry: JournalEntry = {
      timestamp: this.clock.now(),
      report: {
        context: { function: fn, sessionId, parentSessionId, workflowInstanceId: run.workflowInstanceId },
        outcome,
        ...extra,
      },
    };
    this.repository.appendLog(run.workspaceId, entry);
  }

  private recordUsage(run: Run, step: StepRun, cursor: Cursor, tokensIn: number, tokensOut: number): void {
    this.usage.record({
      id: this.ids.mint('usage'),
      tenantId: cursor.tenantId,
      workspaceId: run.workspaceId,
      conversationId: run.conversationId,
      runId: run.id,
      stepSlug: step.stepSlug,
      sessionId: step.sessionId,
      userId: run.launchedBy.kind === 'human' ? run.launchedBy.userId : null,
      model: step.model?.profile ?? 'unresolved',
      source: 'mock-gateway',
      tokensIn,
      tokensOut,
      at: this.clock.now(),
    });
  }

  private persist(
    run: Run,
    message: string,
    author: ActorRef | { kind: 'harness' } = { kind: 'harness' },
    sessionId?: string,
  ): void {
    this.runs.set(run.id, run);
    this.repository.commit({
      workspaceId: run.workspaceId,
      message: `run ${run.id}: ${message}`,
      sessionId: sessionId ?? run.orchestratorSessionId,
      runId: run.id,
      stepSlug: null,
      author,
      changes: { [`runs/${run.id}.run.json`]: JSON.stringify(run, null, 2) },
      timestamp: this.clock.now(),
    });
  }

  private require(runId: RunId): Run {
    const run = this.runs.get(runId);
    if (!run) throw new DomainError('run-missing', `Run ${runId} not found`);
    return run;
  }

  private cursor(runId: RunId): Cursor {
    const cursor = this.cursors.get(runId);
    if (!cursor)
      throw new DomainError('run-missing', `Run ${runId} has no runtime cursor (not launched in this session)`);
    return cursor;
  }
}

function pendingStep(step: StepDefinition, attempt: number): StepRun {
  return {
    stepSlug: step.slug,
    actor: step.actor,
    sessionId: 'unassigned',
    attempt,
    status: 'pending',
    model: null,
    tokens: { input: 0, output: 0 },
    artifactPath: null,
    commitSha: null,
    verdicts: [],
    challengeRounds: 0,
    startedAt: null,
    endedAt: null,
  };
}

/** Rewrites frontmatter keys of an artifact while keeping its body. */
export function setFrontmatter(
  content: string,
  patch: Record<string, string | number | boolean | null | string[]>,
): string {
  const parsed = parseArtifact(content);
  const frontmatter = { ...parsed.frontmatter, ...patch };
  return `${serializeFrontmatter(frontmatter)}\n${parsed.body.startsWith('\n') ? parsed.body : `\n${parsed.body}`}`;
}
