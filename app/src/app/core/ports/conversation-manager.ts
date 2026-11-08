import type { Conversation } from '../domain/conversation';
import type { Notification } from '../domain/notification';
import type { ConversationId, NotificationId, UserId, WorkspaceId } from '../domain/types';

/**
 * Port of the **conversation manager** backend (`oap-conversation-manager`): conversations,
 * threads, messages, launch proposals and the notifications sent to humans (F1, F17, S22).
 *
 * Mocked in `infrastructure/conversation-manager/`.
 */

export interface ConversationRepository {
  get(id: ConversationId): Conversation | undefined;
  listByWorkspace(workspaceId: WorkspaceId): readonly Conversation[];
  save(conversation: Conversation): void;
}

export interface NotificationStore {
  push(notification: Notification): void;
  forUser(userId: UserId): readonly Notification[];
  markRead(id: NotificationId, readAt: string): void;
  markAllRead(userId: UserId, readAt: string): void;
}
