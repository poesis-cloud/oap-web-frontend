import type { ActorRef } from '../domain/types';
import { Actor } from '../domain/types';
import { findAgent, findWorkflow, type OrganizationPackage, type WorkflowDefinition } from '../domain/organization';
import type { Member } from '../domain/types';
import type { Addressee } from '../ports';

/**
 * Addressee rule (F17-R4, F1-R9): a message without mention goes to the dispatcher (Copilot);
 * `@agent` addresses that agent and adds it to the participants; `/workflow` addresses the
 * orchestrator of that workflow. Unknown mentions are ignored (not actors of this workspace).
 */

export interface ParsedMessage {
  readonly mentions: readonly ActorRef[];
  readonly targetWorkflow: string | null;
  readonly addressee: Addressee;
}

const MENTION = /(^|\s)@([a-z0-9][a-z0-9-]*)/g;
const WORKFLOW = /(^|\s)\/([a-z0-9][a-z0-9-]*)/g;

export function parseMessage(
  content: string,
  organization: OrganizationPackage,
  members: readonly Member[],
): ParsedMessage {
  const mentions: ActorRef[] = [];
  for (const match of content.matchAll(MENTION)) {
    const slug = match[2];
    if (findAgent(organization, slug)) {
      mentions.push(Actor.agent(slug));
    } else {
      const member = members.find((m) => m.userId === slug);
      if (member) mentions.push(Actor.human(member.userId));
    }
  }
  let targetWorkflow: string | null = null;
  for (const match of content.matchAll(WORKFLOW)) {
    if (findWorkflow(organization, match[2])) {
      targetWorkflow = match[2];
      break;
    }
  }
  const firstAgent = mentions.find((m) => m.kind === 'agent');
  let addressee: Addressee;
  if (targetWorkflow) {
    const workflow = findWorkflow(organization, targetWorkflow) as WorkflowDefinition;
    addressee = { kind: 'workflow', workflowSlug: targetWorkflow, agent: workflow.orchestrator };
  } else if (firstAgent && firstAgent.kind === 'agent') {
    addressee = { kind: 'agent', agent: firstAgent.slug };
  } else {
    addressee = { kind: 'dispatcher', agent: organization.dispatcher };
  }
  return { mentions: dedupe(mentions), targetWorkflow, addressee };
}

function dedupe(actors: readonly ActorRef[]): ActorRef[] {
  const seen = new Set<string>();
  return actors.filter((a) => {
    const key = Actor.key(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'for',
  'to',
  'of',
  'in',
  'on',
  'with',
  'is',
  'are',
  'be',
  'this',
  'that',
  'we',
  'i',
  'you',
  'it',
  'as',
  'at',
  'by',
  'from',
  'our',
  'your',
  'my',
  'please',
  'can',
  'could',
  'should',
  'would',
  'do',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Closest workflows by keyword overlap with their descriptions (F1-R10 suggestions). */
export function closestWorkflows(text: string, organization: OrganizationPackage, limit = 3): WorkflowDefinition[] {
  const tokens = new Set(tokenize(text));
  return organization.workflows
    .map((workflow) => {
      const words = tokenize(`${workflow.slug.replace(/-/g, ' ')} ${workflow.description}`);
      const overlap = words.filter((w) => tokens.has(w)).length;
      return { workflow, overlap };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.workflow.slug.localeCompare(b.workflow.slug))
    .slice(0, limit)
    .map((entry) => entry.workflow);
}
