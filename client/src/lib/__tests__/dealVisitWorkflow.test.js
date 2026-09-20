import { describe, test, expect } from 'vitest';
import { DEAL_STAGES, validDealTransitions, dealStageNeedsReason } from '../../lib/dealWorkflow';
import { VISIT_STATUSES, validVisitTransitions, visitActionFor, canReschedule } from '../../lib/visitWorkflow';
import { toInputValue, fromInputValue } from '../../lib/format';

describe('deal workflow mirror (matches backend ALLOWED_TRANSITIONS)', () => {
  test('pipeline order is the fixed 10-stage enum', () => {
    expect(DEAL_STAGES).toEqual([
      'NEW', 'QUALIFIED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'RESERVATION',
      'BOOKING_CONFIRMED', 'AGREEMENT_SIGNED', 'PAYMENT_IN_PROGRESS', 'CLOSED_WON', 'CLOSED_LOST',
    ]);
  });

  test('only valid targets are offered; terminals offer none', () => {
    expect(validDealTransitions('NEW')).toEqual(['QUALIFIED', 'CLOSED_LOST']);
    expect(validDealTransitions('NEGOTIATION')).toEqual(['RESERVATION', 'CLOSED_LOST']);
    expect(validDealTransitions('PAYMENT_IN_PROGRESS')).toEqual(['CLOSED_WON', 'CLOSED_LOST']);
    expect(validDealTransitions('CLOSED_WON')).toEqual([]);
    expect(validDealTransitions('CLOSED_LOST')).toEqual([]);
    expect(validDealTransitions('NOPE')).toEqual([]);
  });

  test('CLOSED_LOST alone requires a lost reason', () => {
    expect(dealStageNeedsReason('CLOSED_LOST')).toBe(true);
    expect(dealStageNeedsReason('CLOSED_WON')).toBe(false);
    expect(dealStageNeedsReason('NEGOTIATION')).toBe(false);
  });
});

describe('visit workflow mirror (matches backend lifecycle map)', () => {
  test('valid targets per status; terminals offer none', () => {
    expect(validVisitTransitions('SCHEDULED')).toEqual(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
    expect(validVisitTransitions('CONFIRMED')).toEqual(['COMPLETED', 'CANCELLED', 'NO_SHOW']);
    expect(validVisitTransitions('COMPLETED')).toEqual([]);
    expect(validVisitTransitions('CANCELLED')).toEqual([]);
    expect(validVisitTransitions('NO_SHOW')).toEqual([]);
  });

  test('each target maps to its dedicated endpoint; cancel needs a reason', () => {
    expect(visitActionFor('CONFIRMED')).toMatchObject({ endpoint: 'confirm', needsReason: false });
    expect(visitActionFor('COMPLETED')).toMatchObject({ endpoint: 'complete', needsReason: false });
    expect(visitActionFor('CANCELLED')).toMatchObject({ endpoint: 'cancel', needsReason: true });
    expect(visitActionFor('NO_SHOW')).toMatchObject({ endpoint: 'no-show', needsReason: false });
    expect(visitActionFor('SCHEDULED')).toBeNull();
  });

  test('reschedule only from SCHEDULED/CONFIRMED', () => {
    expect(canReschedule('SCHEDULED')).toBe(true);
    expect(canReschedule('CONFIRMED')).toBe(true);
    expect(canReschedule('COMPLETED')).toBe(false);
    expect(canReschedule('CANCELLED')).toBe(false);
    expect(canReschedule('NO_SHOW')).toBe(false);
  });

  test('VISIT_STATUSES covers the backend enum', () => {
    expect(VISIT_STATUSES).toEqual(['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
  });
});

describe('datetime-local helpers', () => {
  test('round-trips valid input, nulls invalid', () => {
    const iso = '2026-10-01T10:30:00.000Z';
    const input = toInputValue(iso);
    expect(input).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromInputValue(input)).not.toBeNull();
    expect(toInputValue(null)).toBe('');
    expect(toInputValue('garbage')).toBe('');
    expect(fromInputValue('')).toBeNull();
    expect(fromInputValue('garbage')).toBeNull();
  });
});
