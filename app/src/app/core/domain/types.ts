/**
 * Shared identifiers and value objects of the SAI domain.
 *
 * The domain layer has no Angular dependency. Identifiers are plain strings so that they
 * can travel through APIs and git commit messages unchanged; the SAF harness requires
 * session identifiers to be safe slugs (`[a-z0-9-]+`), see `core/saf/contracts.ts`.
 */

export type TenantId = string;
export type WorkspaceId = string;
export type UserId = string;
export type AgentSlug = string;
export type ConversationId = string;
export type ThreadId = string;
export type MessageId = string;
export type ProposalId = string;
export type RunId = string;
export type GateId = string;
export type NotificationId = string;
export type SessionId = string;
export type CommitSha = string;
export type ArtifactPath = string;
export type IsoDateTime = string;

/**
 * A participant of a conversation: a human (a PIS User) or an agent of the organization
 * loaded in the workspace. An actor is a typed reference, never a stored entity (F17).
 */
export type ActorRef =
  { readonly kind: 'human'; readonly userId: UserId } | { readonly kind: 'agent'; readonly slug: AgentSlug };

export const Actor = {
  human(userId: UserId): ActorRef {
    return { kind: 'human', userId };
  },
  agent(slug: AgentSlug): ActorRef {
    return { kind: 'agent', slug };
  },
  key(actor: ActorRef): string {
    return actor.kind === 'human' ? `human:${actor.userId}` : `agent:${actor.slug}`;
  },
  equals(a: ActorRef, b: ActorRef): boolean {
    return Actor.key(a) === Actor.key(b);
  },
  parse(key: string): ActorRef {
    const [kind, id] = key.split(':', 2);
    if (kind === 'human' && id) return Actor.human(id);
    if (kind === 'agent' && id) return Actor.agent(id);
    throw new Error(`Invalid actor key: ${key}`);
  },
} as const;

/** A human member of the tenant, as projected from PIS claims (R9). SAI stores no credential. */
export interface Member {
  readonly userId: UserId;
  readonly displayName: string;
  /** Permissions in SAI come from PIS Membership claims: administrator or member. */
  readonly permission: 'administrator' | 'member';
  /** Organization-declared roles this human holds in the workspace (e.g. a gate holder role). */
  readonly roles: readonly string[];
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super('invalid-transition', `${entity}: transition ${from} → ${to} is not allowed`);
    this.name = 'InvalidTransitionError';
  }
}

export class AccessDeniedError extends DomainError {
  constructor(message: string) {
    super('access-denied', message);
    this.name = 'AccessDeniedError';
  }
}

export const SAFE_SLUG = /^[a-z0-9-]+$/;

export function assertSafeSlug(value: string, what: string): void {
  if (!SAFE_SLUG.test(value)) {
    throw new DomainError('invalid-slug', `${what} must match ${SAFE_SLUG}: ${value}`);
  }
}
