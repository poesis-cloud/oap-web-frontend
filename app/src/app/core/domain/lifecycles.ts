import { InvalidTransitionError } from './types';

/**
 * Lifecycles owned by SAI (sai#1 "Lifecycles") and the SAF-owned ones SAI only reads.
 * Each table lists the allowed transitions; `transition()` is the single guard used by the
 * application layer, so no state change bypasses the declared lifecycle.
 */

export type WorkspaceStatus = 'provisioning' | 'active' | 'archived';
export type ConversationStatus = 'open' | 'archived' | 'closed';
export type ThreadStatus = 'open' | 'waiting' | 'returned' | 'cancelled';
export type ParticipationStatus = 'joined' | 'left';
export type ProposalStatus = 'proposed' | 'confirmed' | 'superseded' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'waiting-for-gate' | 'succeeded' | 'failed' | 'cancelled';
export type GateStatus = 'pending' | 'approved' | 'approved-with-reservation' | 'rejected' | 'expired';
export type StepRunStatus = 'pending' | 'running' | 'delivered' | 'reverted' | 'failed' | 'cancelled';

type Table<S extends string> = Readonly<Record<S, readonly S[]>>;

export const WORKSPACE_TRANSITIONS: Table<WorkspaceStatus> = {
  provisioning: ['active'],
  active: ['archived'],
  archived: ['active'],
};

/** `closed` is terminal: a validation conversation closes with the gate decision it carried. */
export const CONVERSATION_TRANSITIONS: Table<ConversationStatus> = {
  open: ['archived', 'closed'],
  archived: ['open'],
  closed: [],
};

export const THREAD_TRANSITIONS: Table<ThreadStatus> = {
  open: ['waiting', 'returned', 'cancelled'],
  waiting: ['open', 'cancelled'],
  returned: [],
  cancelled: [],
};

export const PROPOSAL_TRANSITIONS: Table<ProposalStatus> = {
  proposed: ['confirmed', 'superseded', 'cancelled'],
  confirmed: [],
  superseded: [],
  cancelled: [],
};

/** SAF-owned (read from the workspace); the demo runtime applies the same table. */
export const RUN_TRANSITIONS: Table<RunStatus> = {
  queued: ['running', 'cancelled'],
  running: ['waiting-for-gate', 'succeeded', 'failed', 'cancelled'],
  'waiting-for-gate': ['running', 'succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export const GATE_TRANSITIONS: Table<GateStatus> = {
  pending: ['approved', 'approved-with-reservation', 'rejected', 'expired'],
  approved: [],
  'approved-with-reservation': [],
  rejected: [],
  expired: [],
};

export function transition<S extends string>(entity: string, table: Table<S>, from: S, to: S): S {
  if (!table[from].includes(to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
  return to;
}

export function isTerminal<S extends string>(table: Table<S>, status: S): boolean {
  return table[status].length === 0;
}
