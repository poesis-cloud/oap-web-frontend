import { closestWorkflows, tokenize } from '../../core/application/dispatch';
import type { AgentResponderPort, AgentResponse, ResponseContext } from '../../core/ports';
import type { Provenance } from '../../core/domain/conversation';
import { findAgent, findWorkflow, type OrganizationPackage } from '../../core/domain/organization';
import { Actor } from '../../core/domain/types';
import { SPECIALIST_ANSWERS } from './scripts';

/**
 * Scripted agent behaviour outside runs. In production an agent answer is a model call
 * resolved from the agent's capability weights within the configured model set (sai#1 S15);
 * here every answer is a fixed text so that the slice is deterministic and free. No free
 * chat (R15): every message leads to a launch proposal, a scoped consultation or an
 * out-of-scope answer with the closest workflows.
 */

const ARCHITECTURE_WORDS = [
  'api',
  'rest',
  'secure',
  'security',
  'architecture',
  'design',
  'adr',
  'auth',
  'authentication',
  'authorization',
  'runway',
  'nfr',
];
const TEAM_WORDS = ['story', 'stories', 'bug', 'iteration', 'sprint', 'test', 'refactor', 'implement'];
const PORTFOLIO_WORDS = ['epic', 'business', 'case', 'portfolio', 'investment', 'theme'];

export class ScriptedAgents implements AgentResponderPort {
  provenance(agent: string, organization: OrganizationPackage): Provenance {
    const definition = findAgent(organization, agent);
    return {
      agent: definition?.name ?? agent,
      model: 'none (scripted)',
      provider: 'demo runtime',
      region: 'local browser',
      hostingClass: 'demo-scripted',
      source: 'demo-runtime',
    };
  }

  respond(context: ResponseContext): readonly AgentResponse[] {
    const { addressee, message, organization } = context;
    const text = message.content;
    const tokens = new Set(tokenize(text));
    const has = (words: string[]) => words.some((w) => tokens.has(w));

    const reply = (agent: string, content: string): AgentResponse[] => [{ kind: 'text', agent, content }];
    const previous =
      context.conversation.messages
        .filter((m) => m.threadId === context.thread.id && m.author.kind === 'human' && m.id !== message.id)
        .at(-1)?.content ?? '';
    const topic = `${previous} ${context.conversation.title} ${context.conversation.subject ?? ''} ${text}`;
    if (addressee.kind === 'dispatcher' && message.mentions.some((m) => m.kind === 'human')) return [];
    if (context.thread.parentThreadId && addressee.kind === 'dispatcher' && !message.targetWorkflow) {
      const agent = context.thread.participants.find((p) => p.kind === 'agent');
      return reply(
        agent?.kind === 'agent' ? agent.slug : organization.dispatcher,
        /pain.point|retrospective|reservation/i.test(topic + context.thread.purpose)
          ? `This thread is about “${context.thread.purpose}”. The evidence recorded on the pain point is what we judge: say whether it calls for a workflow improvement (a bounded change to the organization), a product improvement, acceptance as is, or whether it duplicates another pain point, then return your conclusion to the parent conversation. An organization change is a separate run, proposed from Improvement and decided at its gate.`
          : `This is a side discussion about “${context.thread.purpose}”. Address a specialist with @ for a scoped consultation, or return your conclusion to the parent conversation.`,
      );
    }
    if (context.conversation.sessionRef && addressee.kind !== 'workflow') {
      const ref = context.conversation.sessionRef;
      const run = context.runs.find((r) => r.id === ref.runId);
      const step = run?.steps.find((st) => st.sessionId === ref.sessionId);
      const actor = addressee.kind === 'agent' ? addressee.agent : ref.agent;
      if (!step)
        return reply(
          actor,
          'This session belongs to an earlier attempt. Its messages and journal remain available; the current attempt has a separate session in the run.',
        );
      return reply(
        actor,
        `This session covers ${ref.stepSlug} in ${run?.workflowSlug}. ${step.status === 'delivered' ? 'The artifact has been delivered; this discussion does not rewrite it.' : 'The simulated step is in progress.'} ${step.artifactPath ? `Review ${step.artifactPath} and its journal for the evidence.` : 'The artifact will appear after validation.'} ${actor === ref.agent ? 'I own this step.' : 'I am responding as a consulted specialist, not as the author of this step.'} Changes require a new governed run or an actionable gate rejection.`,
      );
    }
    if (addressee.kind === 'workflow') {
      return this.proposeLaunch(addressee.workflowSlug, context);
    }

    if (addressee.kind === 'agent') {
      const agent = findAgent(organization, addressee.agent);
      if (!agent) return [];
      if (context.pendingGate && agent.kind === 'orchestrator') {
        const gate = context.pendingGate;
        return [
          {
            kind: 'text',
            agent: agent.slug,
            content: `Noted. The workflow steps are complete and the run waits at ★ ${gate.label}: a holder of "${gate.holderRole}" approves, approves with a reservation, or rejects with a comment to request rework. I can answer questions about the artifact meanwhile; ask the authoring agent with @ for the detail of a step.`,
          },
        ];
      }
      if (agent.kind === 'orchestrator') {
        const workflow = this.workflowFor(agent.slug, text, context);
        if (workflow) return this.proposeLaunch(workflow, context);
        const answer =
          SPECIALIST_ANSWERS[agent.slug]?.(text) ??
          `I orchestrate ${agent.slug.replace(/-/g, ' ')} workflows: ${organization.workflows
            .filter((w) => w.orchestrator === agent.slug)
            .map((w) => `/${w.slug}`)
            .join(', ')}.`;
        return [{ kind: 'text', agent: agent.slug, content: answer }];
      }
      const scoped = SPECIALIST_ANSWERS[agent.slug];
      return [
        {
          kind: 'text',
          agent: agent.slug,
          content: scoped
            ? scoped(topic)
            : `Within my scope (${agent.scope ?? agent.description}): I take part in workflows as a specialist and do not act outside a run. Ask an orchestrator to launch the matching workflow.`,
        },
      ];
    }

    // Dispatcher (Copilot).
    if (
      has(['organization', 'organisation']) &&
      has(['change', 'upgrade', 'rollback', 'propose', 'improve', 'adjust'])
    ) {
      if (has(['poesis', 'upgrade']))
        return reply(
          organization.dispatcher,
          'Package upgrades and contributions to Poesis need an upstream workflow and a selected package version. This frontend does not publish contributions or simulate an unavailable upgrade. You can review the local improvement and propose an organization-change or rollback.',
        );
      return this.proposeLaunch('organization-change', context);
    }
    if (has(['retrospective', 'rétrospective']))
      return reply(
        'release-train-engineer',
        'Open Workspace → Improvement and start a retrospective. Each recorded pain point gets its own thread, evidence and a conclusion returned to the parent conversation.',
      );
    if (has(['consult', 'compare', 'opinions', 'both'])) {
      return this.consultTwoSpecialists(text, organization);
    }
    if (has(ARCHITECTURE_WORDS)) {
      const handoff: AgentResponse = {
        kind: 'text',
        agent: organization.dispatcher,
        content:
          'This is program-layer architecture work: the matching purpose is Architectural Runway Extension, orchestrated by @release-train-engineer. I am handing it over; the orchestrator will prepare a launch proposal for you to confirm.',
        mentions: [Actor.agent('release-train-engineer')],
      };
      return [handoff, ...this.proposeLaunch('architectural-runway-extension', context)];
    }
    if (has(TEAM_WORDS)) {
      return [
        {
          kind: 'text',
          agent: organization.dispatcher,
          content:
            'This reads as team-layer work (Story grain). The closest workflows are /team-backlog-refinement and /iteration-planning, orchestrated by @scrum-master. Address one of them to get a launch proposal.',
        },
      ];
    }
    if (has(PORTFOLIO_WORDS)) {
      return [
        {
          kind: 'text',
          agent: organization.dispatcher,
          content:
            'This is a portfolio bet. The closest workflow is /epic-lean-business-case, orchestrated by @value-management-officer.',
        },
      ];
    }
    const closest = closestWorkflows(text, organization);
    const suggestions = closest.map((w) => `/${w.slug}`);
    return [
      {
        kind: 'out-of-scope',
        agent: organization.dispatcher,
        suggestions,
        content:
          suggestions.length > 0
            ? `I cannot answer this directly: there is no free chat in OAP, every exchange leads to a workflow or to a specialist within scope. Closest workflows: ${suggestions.join(', ')}. Or address a specialist: @system-architect, @security-expert, @developer.`
            : 'I cannot answer this directly: there is no free chat in OAP, every exchange leads to a workflow or to a specialist within scope. Describe an IT concern (a Feature to design, a Story to refine, an Epic to frame) or address a specialist with @.',
      },
    ];
  }

  private workflowFor(orchestrator: string, text: string, context: ResponseContext): string | null {
    const tokens = new Set(tokenize(text));
    const candidates = context.organization.workflows.filter((w) => w.orchestrator === orchestrator);
    const explicit = candidates.find((w) => text.includes(`/${w.slug}`));
    if (explicit) return explicit.slug;
    if (orchestrator === 'release-train-engineer' && ARCHITECTURE_WORDS.some((w) => tokens.has(w)))
      return 'architectural-runway-extension';
    return null;
  }

  private proposeLaunch(workflowSlug: string, context: ResponseContext): AgentResponse[] {
    const workflow = findWorkflow(context.organization, workflowSlug);
    if (!workflow) return [];
    const intent = context.message.content
      .replace(/\s*\/[a-z0-9-]+/g, '')
      .replace(/\s*@[a-z0-9-]+/g, '')
      .trim();
    if (workflowSlug === 'organization-change') {
      const pain =
        context.workItems.find((i) => i.type === 'pain-point' && i.path === context.conversation.subject) ??
        context.workItems.find((i) => i.type === 'pain-point' && ['open', 'triaged'].includes(i.status));
      const rollback = /rollback|revert|retour arrière/i.test(intent);
      if (!pain && !rollback)
        return [
          {
            kind: 'text',
            agent: workflow.orchestrator,
            content:
              'First record a commit-gate rejection as a pain point in Workspace → Improvement. The change needs traceable evidence.',
          },
        ];
      return [
        {
          kind: 'launch-proposal',
          agent: workflow.orchestrator,
          workflowSlug,
          inputs: { intent, operation: rollback ? 'rollback' : 'change', 'pain-point': pain?.path ?? '' },
          content: `${rollback ? 'Prepare a rollback of the last matching instruction change' : 'Propose an ADR preflight instruction from this pain point'}. System Architect drafts the diff, Quality Engineer challenges it, and I record the scorecard. Review the exact diff at the ★ Organization Gate. This is a frontend simulation; no organization file changes before approval.`,
        },
      ];
    }
    if (workflowSlug === 'improvement-backlog') {
      const id = intent.match(/run-\d+/)?.[0];
      const source = context.runs.find((r) => r.id === id);
      const step = source?.steps.find((st) =>
        st.verdicts.some((v) => v.fn === 'check-step-artifact' && v.status === 'reverted'),
      );
      if (!source || !step)
        return [
          {
            kind: 'text',
            agent: workflow.orchestrator,
            content:
              'Select an observed commit-gate rejection in Improvement so I can attach its run and step as evidence.',
          },
        ];
      return [
        {
          kind: 'launch-proposal',
          agent: workflow.orchestrator,
          workflowSlug,
          inputs: { intent, 'source-run': source.id, 'source-step': step.stepSlug },
          content: `Record one pain point from ${source.id} / ${step.stepSlug}, with the rejected verdict and session evidence. I own this mediation record. It has no evaluation gate and does not change the organization.`,
        },
      ];
    }
    if (workflowSlug !== 'architectural-runway-extension')
      return [
        {
          kind: 'text',
          agent: workflow.orchestrator,
          content: `${workflow.slug} is declared by the SAF package (${workflow.steps.length} steps). Its execution is not simulated in this frontend yet. Available end-to-end demos: /architectural-runway-extension, /improvement-backlog and /organization-change.`,
        },
      ];
    const features = context.workItems.filter((i) => i.type === 'feature');
    const text =
      `${context.conversation.title} ${context.message.content} ${context.conversation.proposals.at(-1)?.inputs['feature'] ?? ''}`.toLowerCase();
    const feature =
      features.find((i) => i.path === context.conversation.subject) ??
      (text.includes('sandbox') ? features.find((i) => i.path.includes('/partner-sandbox/')) : undefined) ??
      features.find((i) => i.itemId && new RegExp(`\\b${i.itemId.toLowerCase()}\\b`).test(text)) ??
      (text.includes('subscription')
        ? features.find((i) => i.path.includes('/customer-subscriptions-api/'))
        : undefined);
    if (!feature)
      return [
        {
          kind: 'text',
          agent: workflow.orchestrator,
          content:
            'Which Feature should this architecture run serve? Open a Feature and choose Discuss, or name F-12 (subscriptions) or F-15 (partner sandbox). No artifact has been selected yet.',
        },
      ];
    const featureSlug = feature.path.split('/').slice(-2, -1)[0];
    const segments = feature.path.split('/');
    const art = segments[segments.indexOf('art') + 1];
    const inputs: Record<string, string> = {
      product: 'customer-platform',
      art,
      feature: feature?.itemId ?? 'F-12',
      'feature-slug': featureSlug,
      'feature-title': feature?.title ?? 'Secure REST API for customer subscriptions',
      intent:
        context.message.content
          .replace(/\s*\/[a-z0-9-]+/g, '')
          .replace(/\s*@[a-z0-9-]+/g, '')
          .trim() || 'Design a secure REST API for customer subscriptions',
    };
    return [
      {
        kind: 'launch-proposal',
        agent: workflow.orchestrator,
        workflowSlug,
        inputs,
        content: `Launch proposal — Architectural Runway Extension for ${inputs['feature']} "${inputs['feature-title']}" (product ${inputs['product']}, ART ${inputs['art']}). Steps: NFR list and ADR by @system-architect, challenge packets by @security-expert, @operator and @developer, then owner updates to the NFRs, ADR, runway and served Feature. The run stops at the ★ Architecture Gate for a human decision. Nothing starts until a human participant confirms.`,
      },
    ];
  }

  private consultTwoSpecialists(text: string, organization: OrganizationPackage): AgentResponse[] {
    const topic = text.replace(/\s*@[a-z0-9-]+/g, '').trim();
    return [
      {
        kind: 'consult',
        agent: organization.dispatcher,
        consulted: 'system-architect',
        purpose: `Consultation: architecture view on "${topic}"`,
        answer: SPECIALIST_ANSWERS['system-architect'](topic),
        returnContent:
          'Returned from @system-architect: one ADR on authentication, authorization and tenant isolation, backed by an NFR register.',
      },
      {
        kind: 'consult',
        agent: organization.dispatcher,
        consulted: 'security-expert',
        purpose: `Consultation: security view on "${topic}"`,
        answer: SPECIALIST_ANSWERS['security-expert'](topic),
        returnContent:
          'Returned from @security-expert: settle tenant enumeration, partner token replay and scope breadth first.',
      },
      {
        kind: 'resume',
        agent: organization.dispatcher,
        content:
          'Both consultations returned. The architect frames one ADR; the security expert names the three risks it must settle. To do it properly, say /architectural-runway-extension and confirm the launch proposal.',
      },
    ];
  }
}
