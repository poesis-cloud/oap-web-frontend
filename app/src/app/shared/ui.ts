import { Component, computed, input, Pipe, type PipeTransform } from '@angular/core';
import { Avatar } from 'primeng/avatar';
import { Tag } from 'primeng/tag';
import type { Provenance } from '../core/domain/conversation';
import type { ActorRef } from '../core/domain/types';

/** Small presentational pieces shared by the pages. No business rule lives here. */

@Pipe({ name: 'tokens', standalone: true })
export class TokensPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
  }
}

@Pipe({ name: 'ago', standalone: true })
export class AgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const diff = Date.now() - new Date(value).getTime();
    const s = Math.round(diff / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(value).toLocaleDateString();
  }
}

@Pipe({ name: 'clock', standalone: true })
export class ClockPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

@Pipe({ name: 'title', standalone: true })
export class TitlePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return titleCase(value ?? '');
  }
}

export type Tone = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';

/** Maps a lifecycle status (SAI or SAF) to a PrimeNG tag severity. Text always carries the meaning too. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'succeeded':
    case 'approved':
    case 'approved-with-reservation':
    case 'delivered':
    case 'done':
    case 'accepted':
    case 'ready':
    case 'valid':
    case 'pass':
    case 'allowed':
    case 'active':
    case 'returned':
    case 'closed':
      return 'success';
    case 'running':
    case 'queued':
    case 'in-progress':
    case 'implementing':
    case 'committed':
    case 'proposed':
    case 'open':
    case 'started':
    case 'resolved':
    case 'step-resolution':
    case 'ended':
      return 'info';
    case 'waiting-for-gate':
    case 'pending':
    case 'arch-pending':
    case 'waiting':
    case 'analyzing':
    case 'triaged':
    case 'no-next-step':
      return 'warn';
    case 'failed':
    case 'rejected':
    case 'reverted':
    case 'blocked':
    case 'cancelled':
    case 'denied':
    case 'fail':
    case 'expired':
      return 'danger';
    default:
      return 'secondary';
  }
}

@Component({
  selector: 'sai-status',
  standalone: true,
  imports: [Tag],
  template: `<p-tag [value]="label()" [severity]="tone()" [rounded]="true" />`,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly tone = computed(() => statusTone(this.status()));
  readonly label = computed(() => this.status().replace(/-/g, ' '));
}

@Component({
  selector: 'sai-actor',
  standalone: true,
  imports: [Avatar],
  template: `
    <span
      class="inline-flex items-center gap-1.5 font-semibold text-[0.86rem] text-ink"
      [class.is-agent]="actor().kind === 'agent'"
    >
      <p-avatar
        [label]="initials()"
        [shape]="actor().kind === 'agent' ? 'square' : 'circle'"
        size="normal"
        [styleClass]="actor().kind === 'agent' ? 'sai-avatar-agent' : 'sai-avatar-human'"
      />
      <span>{{ name() }}</span>
      @if (actor().kind === 'agent') {
        <span
          class="rounded-full bg-ai-tint px-1.5 text-[0.62rem] font-bold tracking-wide text-ai"
          title="This participant is an AI agent"
          >AI</span
        >
      }
    </span>
  `,
  styles: `
    :host ::ng-deep .p-avatar {
      width: 1.6rem;
      height: 1.6rem;
      font-size: 0.62rem;
      font-weight: 700;
    }
    :host ::ng-deep .sai-avatar-human {
      background: var(--sai-primary-tint);
      color: var(--sai-primary-tint-text);
    }
    :host ::ng-deep .sai-avatar-agent {
      background: var(--sai-ai-tint);
      color: var(--sai-ai);
      border-radius: 30%;
    }
  `,
})
export class ActorBadge {
  readonly actor = input.required<ActorRef>();
  readonly displayName = input<string | null>(null);
  readonly name = computed(
    () =>
      this.displayName() ??
      (this.actor().kind === 'human'
        ? titleCase((this.actor() as { userId: string }).userId)
        : titleCase((this.actor() as { slug: string }).slug)),
  );
  readonly initials = computed(() =>
    this.name()
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );
}

@Component({
  selector: 'sai-provenance',
  standalone: true,
  template: `
    <details class="sai-fold mt-1">
      <summary>Provenance</summary>
      <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.78rem]">
        <dt class="text-ink-light">Agent</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().agent }}</dd>
        <dt class="text-ink-light">Model</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().model }}</dd>
        <dt class="text-ink-light">Provider</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().provider }}</dd>
        <dt class="text-ink-light">Hosting class</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().hostingClass }}</dd>
        <dt class="text-ink-light">Processing region</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().region }}</dd>
        <dt class="text-ink-light">Model source</dt>
        <dd class="font-mono text-ink-muted">{{ provenance().source }}</dd>
      </dl>
    </details>
  `,
})
export class ProvenanceView {
  readonly provenance = input.required<Provenance>();
}

export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export function actorLabel(
  actor: ActorRef,
  members: ReadonlyArray<{ userId: string; displayName: string }> = [],
): string {
  if (actor.kind === 'human')
    return members.find((m) => m.userId === actor.userId)?.displayName ?? titleCase(actor.userId);
  return titleCase(actor.slug);
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
