import { describe, expect, it } from 'vitest';
import { loadSafePackage } from '../../infrastructure/agent-runtime/package-loader';
import type { Member } from '../domain/types';
import { closestWorkflows, parseMessage } from './dispatch';

const pkg = loadSafePackage();
const members: Member[] = [{ userId: 'alex-moreau', displayName: 'Alex', permission: 'member', roles: [] }];

describe('addressee rule (F17-R4, F1-R9)', () => {
  it('routes an unmentioned message to the Copilot dispatcher', () => {
    const parsed = parseMessage('Design a secure REST API for customer subscriptions.', pkg, members);
    expect(parsed.addressee).toEqual({ kind: 'dispatcher', agent: 'copilot' });
    expect(parsed.mentions).toEqual([]);
    expect(parsed.targetWorkflow).toBeNull();
  });

  it('@agent addresses that agent and lists it as a mention', () => {
    const parsed = parseMessage('@system-architect what do you think?', pkg, members);
    expect(parsed.addressee).toEqual({ kind: 'agent', agent: 'system-architect' });
    expect(parsed.mentions).toEqual([{ kind: 'agent', slug: 'system-architect' }]);
  });

  it('/workflow addresses the orchestrator of that workflow', () => {
    const parsed = parseMessage('/architectural-runway-extension for F-12', pkg, members);
    expect(parsed.addressee).toEqual({
      kind: 'workflow',
      workflowSlug: 'architectural-runway-extension',
      agent: 'release-train-engineer',
    });
  });

  it('ignores mentions of unknown agents and recognizes human members', () => {
    const parsed = parseMessage('@nobody @alex-moreau please look', pkg, members);
    expect(parsed.mentions).toEqual([{ kind: 'human', userId: 'alex-moreau' }]);
    expect(parsed.addressee.kind).toBe('dispatcher');
  });

  it('suggests the closest workflows by keyword overlap', () => {
    const closest = closestWorkflows('plan the iteration and commit the team', pkg);
    expect(closest.map((w) => w.slug)).toContain('iteration-planning');
  });
});
