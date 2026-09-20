import { describe, test, expect } from 'vitest';
import { documentReviewActions } from '../../routes/documents/DocumentDetailPage';
import { isTaskOverdue, taskDisplayStatus } from '../../routes/activities/TasksPage';
import { acceptedTypesLabel } from '../../routes/documents/UploadDialog';

describe('document review action visibility (matches backend lifecycle)', () => {
  test('only UNDER_REVIEW offers verify/reject; REJECTED offers resubmit; VERIFIED offers none', () => {
    expect(documentReviewActions('UNDER_REVIEW')).toEqual(['verify', 'reject']);
    expect(documentReviewActions('REJECTED')).toEqual(['resubmit']);
    expect(documentReviewActions('VERIFIED')).toEqual([]);
    expect(documentReviewActions('NOT_SUBMITTED')).toEqual([]);
    expect(documentReviewActions('SUBMITTED')).toEqual([]);
    expect(documentReviewActions('RESUBMITTED')).toEqual([]);
    expect(documentReviewActions('NOPE')).toEqual([]);
  });
});

describe('task derived overdue (never stored)', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();

  test('OPEN + past dueAt renders OVERDUE', () => {
    expect(isTaskOverdue({ status: 'OPEN', dueAt: past })).toBe(true);
    expect(taskDisplayStatus({ status: 'OPEN', dueAt: past })).toBe('OVERDUE');
  });

  test('OPEN + future dueAt stays OPEN; DONE never overdue', () => {
    expect(isTaskOverdue({ status: 'OPEN', dueAt: future })).toBe(false);
    expect(taskDisplayStatus({ status: 'OPEN', dueAt: future })).toBe('OPEN');
    expect(isTaskOverdue({ status: 'DONE', dueAt: past })).toBe(false);
    expect(taskDisplayStatus({ status: 'DONE', dueAt: past })).toBe('DONE');
  });

  test('null-safe', () => {
    expect(isTaskOverdue(null)).toBeFalsy();
    expect(taskDisplayStatus(null)).toBe('—');
  });
});

describe('upload guardrails are documented UX-only', () => {
  test('accepted-types label names PDF/images and the cap', () => {
    expect(acceptedTypesLabel()).toMatch(/PDF/i);
    expect(acceptedTypesLabel()).toMatch(/10MB/);
  });
});
