import type {
  ArtifactPath,
  ConversationId,
  GateId,
  IsoDateTime,
  NotificationId,
  RunId,
  UserId,
  WorkspaceId,
} from './types';

/**
 * A notification to a human (S22, F18-R4): a gate waits for them, a run ended, a budget
 * alert, an invitation to a validation conversation. Notifications are conversation-manager
 * data (F17); they never carry workspace content, only links to it.
 */
export type NotificationKind =
  'gate-invitation' | 'gate-decided' | 'run-succeeded' | 'run-failed' | 'run-cancelled' | 'budget-alert' | 'invitation';

export interface Notification {
  readonly id: NotificationId;
  readonly userId: UserId;
  readonly workspaceId: WorkspaceId;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly refs: {
    readonly conversationId?: ConversationId;
    readonly runId?: RunId;
    readonly gateId?: GateId;
    readonly artifactPath?: ArtifactPath;
  };
  readonly createdAt: IsoDateTime;
  readonly readAt: IsoDateTime | null;
}
