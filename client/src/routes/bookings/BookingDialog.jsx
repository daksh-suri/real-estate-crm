import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useNavigate } from 'react-router-dom';

// Converts one ACTIVE RESERVATION into a booking in a single server
// transaction (booking insert + unit→BOOKED + reservation→CONVERTED).
// The frontend submits one operation and accepts the server result — it
// never mutates unit or reservation state itself. HOLDs are rejected by the
// backend; the confirm step states the irreversibility up front.
export function BookingDialog({ reservationId: presetReservationId, onClose, onCreated }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const idempotencyKey = useIdempotencyKey();
  const [reservationId, setReservationId] = useState(presetReservationId ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    if (!confirmed) {
      setConfirmed(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await api('/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { reservationId: reservationId.trim() },
      });
      const booking = res.booking ?? res;
      push('Booking recorded; unit booked, reservation converted.', 'success');
      onCreated?.(booking);
      onClose();
      navigate(`/app/bookings/${booking.id}`);
    } catch (err) {
      setError(err);
      setConfirmed(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      title="Convert reservation to booking"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>
            {pending ? 'Converting…' : confirmed ? 'Confirm conversion' : 'Review conversion'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Reservation ID" hint="Must be ACTIVE and type RESERVATION. Holds cannot be booked.">
          <Input value={reservationId} onChange={(e) => { setReservationId(e.target.value); setError(null); setConfirmed(false); }} placeholder="UUID" required />
        </Field>
        {confirmed && (
          <p className="muted" role="status">
            This records the sale in one transaction: the booking row is inserted, the unit becomes BOOKED, and the
            reservation becomes CONVERTED. There is no undo here — cancellation afterwards preserves history and frees
            the unit, but never reopens the reservation.
          </p>
        )}
        {error && (
          <ErrorState
            message={
              error.status === 409
                ? 'This reservation can no longer be converted — it was released, expired, booked, or the unit moved. Refresh its current state and retry only if it is ACTIVE.'
                : error.message
            }
            details={error.details ? JSON.stringify(error.details) : null}
          />
        )}
      </form>
    </Dialog>
  );
}

export function BookingButton({ reservationId, onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="booking" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Convert to booking</Button>
      {open && <BookingDialog reservationId={reservationId} onClose={() => setOpen(false)} onCreated={onCreated} />}
    </PermissionGate>
  );
}

export function CancelBookingDialog({ open, onClose, bookingId, onDone }) {
  const { api } = useAuth();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api(`/bookings/${bookingId}/cancel`, { method: 'POST', body: { cancellationReason: reason.trim() } });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Cancel booking"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Keep booking</Button>
          <Button variant="destructive" onClick={onSubmit} disabled={pending}>{pending ? 'Cancelling…' : 'Cancel booking'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <p className="muted">
          The booking row is preserved with actor, reason, and timestamp. The unit returns to AVAILABLE where
          backend rules permit; the reservation stays CONVERTED — a new reservation is required to book again.
        </p>
        <Field label="Cancellation reason">
          <Input value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} required maxLength={500} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
