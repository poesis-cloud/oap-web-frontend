import type { ConversationRepository, NotificationStore } from '../../core/ports';
import type { Conversation } from '../../core/domain/conversation';
import type { Notification } from '../../core/domain/notification';

/**
 * Mock of the conversation manager (`oap-conversation-manager`): conversations and the
 * notifications sent to humans, kept in memory for the session. The real service will
 * persist them per tenant and push them to the browser (SSE or WebSocket).
 */
export class InMemoryConversations implements ConversationRepository {
  private readonly items = new Map<string, Conversation>();
  get(id: string): Conversation | undefined {
    return this.items.get(id);
  }
  listByWorkspace(workspaceId: string): readonly Conversation[] {
    return [...this.items.values()]
      .filter((c) => c.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  save(conversation: Conversation): void {
    this.items.set(conversation.id, conversation);
  }
}

export class InMemoryNotifications implements NotificationStore {
  private readonly items: Notification[] = [];
  push(notification: Notification): void {
    this.items.push(notification);
  }
  forUser(userId: string): readonly Notification[] {
    return this.items.filter((n) => n.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  markRead(id: string, readAt: string): void {
    const index = this.items.findIndex((n) => n.id === id);
    if (index >= 0 && this.items[index].readAt === null) this.items[index] = { ...this.items[index], readAt };
  }
  markAllRead(userId: string, readAt: string): void {
    for (let i = 0; i < this.items.length; i += 1) {
      if (this.items[i].userId === userId && this.items[i].readAt === null)
        this.items[i] = { ...this.items[i], readAt };
    }
  }
}
