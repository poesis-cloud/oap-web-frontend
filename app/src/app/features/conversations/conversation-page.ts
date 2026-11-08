import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { Tag } from 'primeng/tag';
import { Textarea } from 'primeng/textarea';
import type { Conversation, LaunchProposal, Message, Thread } from '../../core/domain/conversation';
import { mainThread } from '../../core/domain/conversation';
import { pendingGate, type Gate, type Run } from '../../core/domain/run';
import { Actor, type ActorRef } from '../../core/domain/types';
import { GateCard } from '../../shared/gate-card';
import { ActorBadge, ClockPipe, ProvenanceView, StatusBadge, TitlePipe, actorLabel, fileName } from '../../shared/ui';
import { SaiStore } from '../../state/sai-store';

/**
 * One conversation (F1): main thread with child threads in place, agent answers streamed and
 * labelled as AI with provenance, launch proposals to confirm, run links with folded internals.
 * A validation conversation pins the ★ gate it is about: the invited holders decide here.
 */
@Component({
  selector: 'sai-conversation-page',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    Button,
    Dialog,
    InputText,
    Select,
    Tag,
    Textarea,
    GateCard,
    ActorBadge,
    ProvenanceView,
    StatusBadge,
    ClockPipe,
    TitlePipe,
  ],
  templateUrl: './conversation-page.html',
})
export class ConversationPage {
  readonly store = inject(SaiStore);
  readonly id = input.required<string>();
  readonly conversation = computed(() => this.store.conversation(this.id()));
  readonly draft = signal('');
  readonly renaming = signal(false);
  readonly draftTitle = signal('');
  readonly changing = signal<string | null>(null);
  readonly changeDraft = signal('');
  readonly asideDrafts: Record<string, string> = {};

  readonly quickAgents = computed(() =>
    this.store
      .organization()
      .agents.filter((a) =>
        ['system-architect', 'security-expert', 'developer', 'release-train-engineer'].includes(a.slug),
      ),
  );
  readonly structurantFeature = computed(
    () => this.store.workItems().find((i) => i.type === 'feature' && i.structurant) ?? null,
  );
  /** The gate a validation conversation is about, with its run. */
  readonly pinnedGate = computed((): { run: Run; gate: Gate } | null => {
    const ref = this.conversation()?.gateRef;
    if (!ref) return null;
    const run = this.store.run(ref.runId);
    const gate = run?.gates.find((g) => g.id === ref.gateId);
    return run && gate ? { run, gate } : null;
  });

  main(c: Conversation): Thread {
    return mainThread(c);
  }
  messagesOf(c: Conversation, threadId: string): Message[] {
    return c.messages.filter((m) => m.threadId === threadId);
  }
  childThreadsOf(c: Conversation, messageId: string): Thread[] {
    return c.threads.filter((t) => t.openingMessageId === messageId);
  }
  joined(c: Conversation) {
    return c.participants.filter((p) => p.status === 'joined');
  }
  key(actor: ActorRef): string {
    return Actor.key(actor);
  }
  label(actor: ActorRef): string {
    return actorLabel(actor, this.store.tenant().members);
  }
  fileName(path: string): string {
    return fileName(path);
  }
  participantsLabel(t: Thread): string {
    return t.participants.map((p) => this.label(p)).join(', ');
  }
  visible(m: Message): string {
    const len = this.store.streamedLength(m.id);
    return len === undefined ? m.content : m.content.slice(0, len);
  }
  proposalOf(c: Conversation, m: Message): LaunchProposal | undefined {
    return c.proposals.find((p) => p.id === m.refs.proposalId);
  }
  runOf(m: Message): Run | null {
    return m.refs.runId ? this.store.run(m.refs.runId) : null;
  }
  gateOf(m: Message): { run: Run; gate: NonNullable<ReturnType<typeof pendingGate>> } | null {
    const run = m.refs.runId ? this.store.run(m.refs.runId) : null;
    const gate = run?.gates.find((g) => g.id === m.refs.gateId);
    return run && gate ? { run, gate } : null;
  }
  runsOf(c: Conversation): Run[] {
    return c.proposals.map((p) => (p.runId ? this.store.run(p.runId) : null)).filter((r): r is Run => r !== null);
  }
  entries(inputs: Readonly<Record<string, string>>): [string, string][] {
    return Object.entries(inputs);
  }
  delivered(run: Run): number {
    return run.steps.filter((s) => s.status === 'delivered').length;
  }
  progress(run: Run): number {
    return Math.round((this.delivered(run) / Math.max(1, run.steps.length)) * 100);
  }
  invitableAgents(c: Conversation) {
    const joined = new Set(this.joined(c).map((p) => Actor.key(p.actor)));
    return this.store.organization().agents.filter((a) => !joined.has(`agent:${a.slug}`));
  }
  invitableMembers(c: Conversation) {
    const joined = new Set(this.joined(c).map((p) => Actor.key(p.actor)));
    return this.store.tenant().members.filter((m) => !joined.has(`human:${m.userId}`));
  }
  inviteAgent(c: Conversation, slug: string | null): void {
    if (slug) this.store.invite(c.id, Actor.agent(slug));
  }
  inviteHuman(c: Conversation, userId: string | null): void {
    if (userId) this.store.invite(c.id, Actor.human(userId));
  }
  insert(text: string): void {
    this.draft.update((d) => (d.endsWith(' ') || d === '' ? d + text : `${d} ${text}`));
  }
  onEnter(event: Event, c: Conversation): void {
    const e = event as KeyboardEvent;
    if (e.shiftKey) return;
    e.preventDefault();
    this.send(c, event);
  }
  send(c: Conversation, event: Event): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text) return;
    this.store.postMessage(c.id, this.main(c).id, text);
    this.draft.set('');
  }
  sendIn(c: Conversation, t: Thread, event: Event): void {
    event.preventDefault();
    const text = (this.asideDrafts[t.id] ?? '').trim();
    if (!text) return;
    this.store.postMessage(c.id, t.id, text);
    this.asideDrafts[t.id] = '';
  }
  openAside(c: Conversation, m: Message): void {
    const purpose = window.prompt('What do you want to discuss aside?', 'Clarify this point');
    if (purpose !== null) this.store.openChildThread(c.id, m.id, purpose);
  }
  startRename(c: Conversation): void {
    this.draftTitle.set(c.title);
    this.renaming.set(true);
  }
  rename(c: Conversation): void {
    this.store.renameConversation(c.id, this.draftTitle());
    this.renaming.set(false);
  }
  startChange(p: LaunchProposal): void {
    this.changeDraft.set(p.inputs['intent'] ?? '');
    this.changing.set(p.id);
  }
  applyChange(c: Conversation, p: LaunchProposal): void {
    this.store.changeProposal(c.id, p.id, { intent: this.changeDraft().trim() || (p.inputs['intent'] ?? '') });
    this.changing.set(null);
  }
}
