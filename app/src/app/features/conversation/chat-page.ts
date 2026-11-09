import { ChangeReview } from '../../shared/change-review';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Popover } from 'primeng/popover';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';
import { Tooltip } from 'primeng/tooltip';
import type { Artifact } from '../../core/domain/artifact';
import type { Conversation, LaunchProposal, Message, Thread } from '../../core/domain/conversation';
import { mainThread } from '../../core/domain/conversation';
import { type Gate, type Run } from '../../core/domain/run';
import { Actor, type ActorRef } from '../../core/domain/types';
import { GateFlow } from '../../shared/gate-flow';
import { ActorBadge, ClockPipe, ProvenanceView, StatusBadge, TitlePipe, actorLabel, fileName } from '../../shared/ui';
import { Viewer } from '../../shared/viewer';
import { initialsOf } from '../../app';
import { SaiStore } from '../../state/sai-store';

/**
 * One conversation as a chat (F1; Clément, 2026-11-08: inspired by Teams). Messages grouped
 * with avatars, agents labelled AI with provenance, launch proposals and run cards inline, a
 * composer at the bottom. When a run launched here waits at its ★ gate, the gate flow is
 * pinned at the top: the artifact opens in the viewer over the thread and the decision is taken
 * here (2026-11-09: a gate is the orchestrator's message, not a conversation of its own). A
 * worker session conversation shows its step and run in the bar.
 */
@Component({
  selector: 'sai-chat-page',
  host: { class: 'flex h-full min-h-0 flex-col' },
  standalone: true,
  imports: [ChangeReview, NgTemplateOutlet, FormsModule, RouterLink, Button, Dialog, InputText, Popover, Select, Textarea, Tooltip, GateFlow, Viewer, ActorBadge, ProvenanceView, StatusBadge, ClockPipe, TitlePipe],
  templateUrl: './chat-page.html',
})
export class ChatPage {
  readonly store = inject(SaiStore);
  private readonly router = inject(Router);
  readonly id = input.required<string>();
  readonly conversation = computed(() => this.store.conversation(this.id()));
  readonly draft = signal('');
  readonly renaming = signal(false);
  readonly draftTitle = signal('');
  readonly changing = signal<string | null>(null);
  readonly changeDraft = signal('');
  readonly asideDrafts: Record<string, string> = {};
  readonly threadSummaries: Record<string, string> = {};
  readonly viewing = signal<string | null>(null);
  readonly infoOpen = signal(false);
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  constructor() {
    // A chat follows its latest message: scroll to the bottom when one arrives or streams.
    effect(() => {
      const c = this.conversation();
      if (!c) return;
      const last = c.messages.at(-1);
      void c.messages.length;
      if (last) void this.store.streamedLength(last.id);
      const el = this.log()?.nativeElement;
      if (!el) return;
      queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }));
    });
  }

  readonly quickAgents = ['system-architect', 'security-expert', 'developer', 'release-train-engineer'];
  /** The ★ gate waiting in this conversation: the orchestrator's last word until a holder decides. */
  readonly pinnedGate = computed((): { run: Run; gate: Gate } | null => {
    const c = this.conversation();
    if (!c) return null;
    for (const run of this.runsOf(c)) {
      const gate = run.gates.find((g) => g.status === 'pending');
      if (gate) return { run, gate };
    }
    return null;
  });
  /** The worker session this conversation exposes, with its run and step. */
  readonly session = computed(() => {
    const ref = this.conversation()?.sessionRef;
    if (!ref) return null;
    const run = this.store.run(ref.runId);
    const step = run?.steps.find((st) => st.sessionId === ref.sessionId) ?? null;
    return run ? { ref, run, step } : null;
  });
  readonly viewed = computed((): Artifact | null => {
    const path = this.viewing();
    return path ? (this.store.artifacts().find((a) => a.path === path) ?? null) : null;
  });

  main(c: Conversation): Thread {
    return mainThread(c);
  }
  /** Gate conversations are titled "★ …" by the application; the bar already shows the star. */
  plainTitle(c: Conversation): string {
    return c.title.replace(/^★\s*/, '');
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
  initials(actor: ActorRef): string {
    return initialsOf(this.label(actor));
  }
  isMine(actor: ActorRef): boolean {
    return actor.kind === 'human' && actor.userId === this.store.session().userId;
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
  gateOf(m: Message): { run: Run; gate: Gate } | null {
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
  returnThread(c: Conversation, t: Thread): void {
    if (this.store.returnChildThread(c.id, t.id, this.threadSummaries[t.id] ?? '')) this.threadSummaries[t.id] = '';
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
  discuss(path: string): void {
    this.viewing.set(null);
    const conversation = this.store.startConversation(`About ${fileName(path)}`, null, path);
    if (conversation) void this.router.navigate(['/conversation', conversation.id]);
  }
}
