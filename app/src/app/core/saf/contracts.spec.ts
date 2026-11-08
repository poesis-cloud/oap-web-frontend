import { describe, expect, it } from 'vitest';
import { isValidJournalEntry, mintWorkflowInstanceId, WORKFLOW_INSTANCE_ID_PATTERN } from './contracts';

const valid = {
  timestamp: '2026-07-08T14:32:07Z',
  report: {
    context: {
      function: 'check-step-postconditions',
      sessionId: '01j9xqr7t3',
      parentSessionId: '01j9xq0f2m',
      workflowInstanceId: 'verification-01J9XQ',
    },
    outcome: { status: 'pass' },
    conditionChecks: [],
  },
};

describe('harness log-entry contract', () => {
  it('accepts the specification example', () => {
    expect(isValidJournalEntry(valid)).toBe(true);
  });

  it('rejects an entry with extra top-level keys, an unknown function or an unsafe session id', () => {
    expect(isValidJournalEntry({ ...valid, extra: 1 })).toBe(false);
    expect(
      isValidJournalEntry({
        ...valid,
        report: { ...valid.report, context: { ...valid.report.context, function: 'orchestrate' } },
      }),
    ).toBe(false);
    expect(
      isValidJournalEntry({
        ...valid,
        report: { ...valid.report, context: { ...valid.report.context, sessionId: '../etc' } },
      }),
    ).toBe(false);
  });

  it('requires error detail on error statuses and forbids it otherwise', () => {
    expect(isValidJournalEntry({ ...valid, report: { ...valid.report, outcome: { status: 'state-error' } } })).toBe(
      false,
    );
    expect(
      isValidJournalEntry({
        ...valid,
        report: {
          ...valid.report,
          outcome: { status: 'state-error', error: { code: 'session-ended', message: 'ended' } },
        },
      }),
    ).toBe(true);
    expect(
      isValidJournalEntry({
        ...valid,
        report: { ...valid.report, outcome: { status: 'pass', error: { code: 'x', message: 'y' } } },
      }),
    ).toBe(false);
  });

  it('mints workflow instance ids with the slug prefix and a Crockford base32 mint', () => {
    const id = mintWorkflowInstanceId('architectural-runway-extension', 12345);
    expect(id.startsWith('architectural-runway-extension-')).toBe(true);
    expect(WORKFLOW_INSTANCE_ID_PATTERN.test(id)).toBe(true);
    expect(mintWorkflowInstanceId('x', 1)).not.toBe(mintWorkflowInstanceId('x', 2));
  });
});
