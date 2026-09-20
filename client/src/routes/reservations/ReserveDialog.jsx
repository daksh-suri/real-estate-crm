import { useState } from 'react';
import { Button, Field, Input, Select } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { fromInputValue, toInputValue } from '../../lib/format';
import { useNavigate } from 'react-router-dom';

const TYPES = ['RESERVATION', 'HOLD'];

// Creates one Reservation row (RESERVATION or HOLD — same endpoint, type
// discriminator). dealId is required by the backend; the transaction owns
// availability, conflicts surface as 409. The idempotency key is stable for
// this submission instance, so a timeout retry replays instead of forking.
export function ReserveButton({ unitId, onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="reservation" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Reserve / Hold</Button>
      {open && <ReserveDialog unitId={unitId} onClose={() => setOpen(false)} onCreated={onCreated} />}
    </PermissionGate>
  );
}

export function ReserveDialog({ unitId: presetUnitId, onClose, onCreated }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const idempotencyKey = useIdempotencyKey();
  const [unitId, setUnitId] = useState(presetUnitId ?? '');
  const [dealId, setDealId] = useState('');
  const [type, setType] = useState('RESERVATION');
  const [expiresAt, setExpiresAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api('/reservations', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          unitId: unitId.trim(),
          dealId: dealId.trim(),
          type,
          expiresAt: expiresAt ? fromInputValue(expiresAt) : null,
        },
      });
      const reservation = res.reservation ?? res;
      push(`${type === 'HOLD' ? 'Hold placed.' : 'Unit reserved.'}`, 'success');
      onCreated?.(reservation);
      onClose();
      navigate(`/app/reservations/${reservation.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      title={type === 'HOLD' ? 'Place hold' : 'Reserve unit'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Submitting…' : 'Submit'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t === 'HOLD' ? 'Hold (no booking path)' : 'Reservation (bookable)'}</option>
            ))}
          </Select>
        </Field>
        <Field label="Unit ID" hint="Must be AVAILABLE at commit time — the server decides, not this form.">
          <Input value={unitId} onChange={(e) => { setUnitId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Deal ID" hint="Required. A unit-less deal is bound to the unit in the same transaction.">
          <Input value={dealId} onChange={(e) => { setDealId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Expires at (optional)" hint="Empty = no expiry (management hold). Past values are rejected.">
          <Input type="datetime-local" value={expiresAt} min={toInputValue(new Date())} onChange={(e) => { setExpiresAt(e.target.value); setError(null); }} />
        </Field>
        {error && (
          <ErrorState
            message={
              error.status === 409
                ? 'This unit is no longer available — another agent claimed it first. Check the unit page for its current status, then retry with a fresh submission.'
                : error.message
            }
            details={error.details ? JSON.stringify(error.details) : null}
          />
        )}
      </form>
    </Dialog>
  );
}
