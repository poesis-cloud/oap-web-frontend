import { describe, expect, it } from 'vitest';
import {
  GATE_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
  RUN_TRANSITIONS,
  THREAD_TRANSITIONS,
  transition,
  WORKSPACE_TRANSITIONS,
} from './lifecycles';
import { InvalidTransitionError } from './types';

describe('lifecycles (sai#1)', () => {
  it('workspace: provisioning → active ↔ archived; never back to provisioning', () => {
    expect(transition('workspace', WORKSPACE_TRANSITIONS, 'provisioning', 'active')).toBe('active');
    expect(transition('workspace', WORKSPACE_TRANSITIONS, 'active', 'archived')).toBe('archived');
    expect(transition('workspace', WORKSPACE_TRANSITIONS, 'archived', 'active')).toBe('active');
    expect(() => transition('workspace', WORKSPACE_TRANSITIONS, 'active', 'provisioning')).toThrow(
      InvalidTransitionError,
    );
  });

  it('launch proposal: proposed is the only non-terminal state (F17-R2)', () => {
    for (const to of ['confirmed', 'superseded', 'cancelled'] as const) {
      expect(transition('proposal', PROPOSAL_TRANSITIONS, 'proposed', to)).toBe(to);
    }
    expect(() => transition('proposal', PROPOSAL_TRANSITIONS, 'confirmed', 'proposed')).toThrow(InvalidTransitionError);
  });

  it('thread: open ↔ waiting, child ends returned or cancelled', () => {
    expect(transition('thread', THREAD_TRANSITIONS, 'open', 'waiting')).toBe('waiting');
    expect(transition('thread', THREAD_TRANSITIONS, 'waiting', 'open')).toBe('open');
    expect(() => transition('thread', THREAD_TRANSITIONS, 'returned', 'open')).toThrow(InvalidTransitionError);
  });

  it('run and gate: no auto-approval path, terminal states stay terminal', () => {
    expect(transition('run', RUN_TRANSITIONS, 'running', 'waiting-for-gate')).toBe('waiting-for-gate');
    expect(transition('run', RUN_TRANSITIONS, 'waiting-for-gate', 'running')).toBe('running');
    expect(() => transition('run', RUN_TRANSITIONS, 'succeeded', 'running')).toThrow(InvalidTransitionError);
    expect(transition('gate', GATE_TRANSITIONS, 'pending', 'rejected')).toBe('rejected');
    expect(() => transition('gate', GATE_TRANSITIONS, 'rejected', 'approved')).toThrow(InvalidTransitionError);
  });
});
