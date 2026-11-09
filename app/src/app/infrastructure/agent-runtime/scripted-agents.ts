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
            content: `Noted. The workflow is complete and waits at ★ ${gate.label}: a holder of "${gate.holderRole}" approves, approves with a reservation, or rejects with a comment, and that closes it. I can answer questions about the artifact meanwhile; ask the authoring agent with @ for the detail of a step.`,
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
            ? scoped(text)
            : `Within my scope (${agent.scope ?? agent.description}): I take part in workflows as a specialist and do not act outside a run. Ask an orchestrator to launch the matching workflow.`,
        },
      ];
    }

    // Dispatcher (Copilot).
    if (has(['organization', 'organisation']) && has(['change', 'upgrade', 'rollback', 'propose', 'improve', 'adjust'])) {
      return [
        {
          kind: 'text',
          agent: organization.dispatcher,
          content:
            'A change to the organization is applied by the organization-change workflow (SAF SF11; a rollback is the same workflow with a revert, an upgrade goes through organization-upgrade, SF13), drafted by the owning agent, challenged, validated by the harness and decided at the ★ Organization gate. This package version does not declare these workflows yet, so nothing can be launched: I hand your proposal to @release-train-engineer as a pain point for the next Inspect & Adapt (/inspect-and-adapt), which is where improvements are decided today.',
          mentions: [Actor.agent('release-train-engineer')],
        },
      ];
    }
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
            ? `I cannot answer this directly: SAI has no free chat, every exchange leads to a workflow or to a specialist within scope. Closest workflows: ${suggestions.join(', ')}. Or address a specialist: @system-architect, @security-expert, @developer.`
            : 'I cannot answer this directly: SAI has no free chat, every exchange leads to a workflow or to a specialist within scope. Describe an IT concern (a Feature to design, a Story to refine, an Epic to frame) or address a specialist with @.',
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
    const feature =
      context.workItems.find((item) => item.type === 'feature' && item.structurant) ??
      context.workItems.find((item) => item.type === 'feature');
    const featureSlug = feature ? feature.path.split('/').slice(-2, -1)[0] : 'customer-subscriptions-api';
    const art = feature ? feature.path.split('/')[1] : 'platform';
    if (workflowSlug !== 'architectural-runway-extension') {
      return [
        {
          kind: 'text',
          agent: workflow.orchestrator,
          content: `${workflow.slug} is in my catalog (${workflow.steps.length} steps). In this build only Architectural Runway Extension can be launched end to end; the other workflows will be wired when the agent runtime serves the full package.`,
        },
      ];
    }
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
        content: `Launch proposal — Architectural Runway Extension for ${inputs['feature']} "${inputs['feature-title']}" (product ${inputs['product']}, ART ${inputs['art']}). Steps: NFR list and ADR by @system-architect, challenge packets by @security-expert, @operator and @developer, then the owner rewrite into the architecture runway. The run stops at the ★ Architecture Gate for a human decision. Nothing starts until a human participant confirms.`,
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
