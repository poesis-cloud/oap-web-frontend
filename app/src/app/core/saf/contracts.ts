/**
 * Types mirrored from the SAF harness contracts (`saf-agentic-harness/contracts/`, Apache-2.0):
 * the report envelope, the context, the twelve function names and the log entry. SAI never
 * writes these entries; it reads them from the hosted workspace's logs. The demo runtime
 * produces entries in this exact shape so that the views exercise the real contract.
 *
 * Source of truth: `def/core/spec.md` and `contracts/*.schema.json` of the harness
 * (tag v1.0.0-beta.1 lineage, checked 2026-11-08).
 */

export const HARNESS_FUNCTIONS = [
  'start-session',
  'resolve-workflow-instructions',
  'resolve-workflow-skills',
  'resolve-step',
  'resolve-step-model',
  'check-step-preconditions',
  'resolve-step-instructions',
  'resolve-step-skills',
  'check-step-authorization',
  'check-step-artifact',
  'check-step-postconditions',
  'end-session',
] as const;

export type HarnessFunction = (typeof HARNESS_FUNCTIONS)[number];

export const ERROR_STATUSES = ['inquiry-error', 'state-error', 'configuration-error', 'system-error'] as const;

export interface ReportContext {
  readonly function: HarnessFunction;
  /** Safe slug `[a-z0-9-]+`: the id becomes a log filename. */
  readonly sessionId: string;
  readonly parentSessionId: string | null;
  /** `<workflowSlug>-<CROCKFORD32>`, minted by the harness only. */
  readonly workflowInstanceId: string | null;
}

export interface ReportOutcome {
  readonly status: string;
  readonly error?: { readonly code: string; readonly message: string; readonly retryable?: boolean };
}

export interface ResolvedStep {
  readonly slug: string;
  readonly actor: string;
  readonly artifact: string;
  readonly skills: readonly string[];
  readonly instructions: readonly string[];
  readonly capabilities: Readonly<Record<string, number>>;
  readonly conditions: readonly unknown[];
  readonly description?: string;
}

export interface ModelProfileReport {
  readonly slug: string;
  readonly score: number;
  readonly costRank: number;
  readonly reason: string;
}

export interface ArtifactCheckRecord {
  readonly artifactPath: string;
  readonly failureMessage: string;
  readonly revert: { readonly action: 'restored' | 'deleted'; readonly from?: string };
}

export interface Report {
  readonly context: ReportContext;
  readonly outcome: ReportOutcome;
  readonly step?: ResolvedStep;
  readonly profile?: ModelProfileReport;
  readonly artifactChecks?: readonly ArtifactCheckRecord[];
  readonly conditionChecks?: readonly unknown[];
  readonly agent?: string;
}

/** One append-only JSONL entry: `{timestamp, report}` and nothing else. */
export interface JournalEntry {
  readonly timestamp: string;
  readonly report: Report;
}

export const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;
export const WORKFLOW_INSTANCE_ID_PATTERN = /^[a-z0-9-]+-[0-9A-HJKMNP-TV-Z]{4,}$/;

export function isValidJournalEntry(entry: unknown): entry is JournalEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e['timestamp'] !== 'string') return false;
  if (Object.keys(e).length !== 2) return false;
  const report = e['report'] as Record<string, unknown> | undefined;
  if (!report || typeof report !== 'object') return false;
  const context = report['context'] as Record<string, unknown> | undefined;
  const outcome = report['outcome'] as Record<string, unknown> | undefined;
  if (!context || !outcome) return false;
  if (!HARNESS_FUNCTIONS.includes(context['function'] as HarnessFunction)) return false;
  if (typeof context['sessionId'] !== 'string' || !SESSION_ID_PATTERN.test(context['sessionId'])) return false;
  const parent = context['parentSessionId'];
  if (parent !== null && (typeof parent !== 'string' || !SESSION_ID_PATTERN.test(parent))) return false;
  const instance = context['workflowInstanceId'];
  if (instance !== null && instance !== undefined) {
    if (typeof instance !== 'string' || !WORKFLOW_INSTANCE_ID_PATTERN.test(instance)) return false;
  }
  if (typeof outcome['status'] !== 'string' || outcome['status'].length === 0) return false;
  const isError = (ERROR_STATUSES as readonly string[]).includes(outcome['status']);
  if (isError && !outcome['error']) return false;
  if (!isError && outcome['error']) return false;
  return true;
}

/** Crockford base32 alphabet used by the harness for instance id mints. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function mintWorkflowInstanceId(workflowSlug: string, seed: number): string {
  let n = Math.abs(Math.floor(seed)) % 32 ** 6;
  let mint = '';
  for (let i = 0; i < 6; i += 1) {
    mint = CROCKFORD[n % 32] + mint;
    n = Math.floor(n / 32);
  }
  return `${workflowSlug}-${mint}`;
}
