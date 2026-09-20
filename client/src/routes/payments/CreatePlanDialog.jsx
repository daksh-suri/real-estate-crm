import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useNavigate } from 'react-router-dom';
import { fromInputValue } from '../../lib/format';

// Creates one deal-specific plan: booking context + an explicit obligations
// array (the schedule). No templates exist in V1 by design. One row minimum,
// validated client-side for UX with the server authoritative.
function emptyRow() {
  return { dueAmount: '', dueDate: '' };
}

export function CreatePlanButton({ bookingId, onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="paymentPlan" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Create payment plan</Button>
      {open && <CreatePlanDialog bookingId={bookingId} onClose={() => setOpen(false)} onCreated={onCreated} />}
    </PermissionGate>
  );
}

export function CreatePlanDialog({ bookingId: presetBookingId, onClose, onCreated }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const idempotencyKey = useIdempotencyKey();
  const [bookingId, setBookingId] = useState(presetBookingId ?? '');
  const [rows, setRows] = useState([emptyRow()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  function setRow(i, patch) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setError(null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    if (rows.length < 1 || rows.length > 100) {
      setError(Object.assign(new Error('Add between 1 and 100 obligations.'), { statusCode: 400 }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const obligations = rows.map((r) => {
        const dueAmount = Number(r.dueAmount);
        const dueDate = fromInputValue(r.dueDate);
        if (!(dueAmount > 0) || !dueDate) {
          throw Object.assign(new Error('Each obligation needs a positive amount and a valid due date.'), { statusCode: 400 });
        }
        return { dueAmount, dueDate };
      });
      const res = await api('/payment-plans', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: { bookingId: bookingId.trim(), obligations },
      });
      const plan = res.plan ?? res;
      push('Payment plan created.', 'success');
      onCreated?.(plan);
      onClose();
      navigate(`/app/payments/${plan.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      title="Create payment plan"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Creating…' : 'Create plan'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Booking ID" hint="The plan hangs off the booking's deal. One plan per deal.">
          <Input value={bookingId} onChange={(e) => { setBookingId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        {rows.map((r, i) => (
          <fieldset key={i} className="obligation-row">
            <legend>Obligation {i + 1}</legend>
            <Field label="Amount">
              <Input type="number" min="0.01" step="0.01" value={r.dueAmount} onChange={(e) => setRow(i, { dueAmount: e.target.value })} required />
            </Field>
            <Field label="Due date">
              <Input type="datetime-local" value={r.dueDate} onChange={(e) => setRow(i, { dueDate: e.target.value })} required />
            </Field>
            {rows.length > 1 && (
              <Button variant="ghost" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>Remove</Button>
            )}
          </fieldset>
        ))}
        {rows.length < 100 && (
          <Button variant="secondary" onClick={() => setRows((prev) => [...prev, emptyRow()])}>Add obligation</Button>
        )}
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
