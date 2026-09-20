import { describe, test, expect } from 'vitest';
import { canConvertReservation } from '../../routes/reservations/ReservationDetailPage';
import { isBookingCancelled } from '../../routes/bookings/BookingDetailPage';
import { isObligationOverdue } from '../../routes/payments/PlanDetailPage';

describe('reservation conversion visibility', () => {
  test('only ACTIVE RESERVATION offers convert; HOLD never converts', () => {
    expect(canConvertReservation({ status: 'ACTIVE', type: 'RESERVATION' })).toBe(true);
    expect(canConvertReservation({ status: 'ACTIVE', type: 'HOLD' })).toBe(false);
    expect(canConvertReservation({ status: 'EXPIRED', type: 'RESERVATION' })).toBe(false);
    expect(canConvertReservation({ status: 'CONVERTED', type: 'RESERVATION' })).toBe(false);
    expect(canConvertReservation({ status: 'RELEASED', type: 'RESERVATION' })).toBe(false);
    expect(canConvertReservation(null)).toBeFalsy();
  });
});

describe('booking cancelled display (no status enum)', () => {
  test('cancelled triple drives the badge, nothing else', () => {
    expect(isBookingCancelled({ cancelledAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
    expect(isBookingCancelled({ cancelledAt: null })).toBe(false);
    expect(isBookingCancelled({})).toBe(false);
    expect(isBookingCancelled(null)).toBe(false);
  });
});

describe('overdue is derived, never stored', () => {
  test('OVERDUE status from the server drives the display', () => {
    expect(isObligationOverdue({ status: 'OVERDUE' })).toBe(true);
    expect(isObligationOverdue({ status: 'PENDING' })).toBe(false);
    expect(isObligationOverdue({ status: 'PAID' })).toBe(false);
    expect(isObligationOverdue(null)).toBeFalsy();
  });
});
