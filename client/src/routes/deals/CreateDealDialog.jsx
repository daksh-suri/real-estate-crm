import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useNavigate } from 'react-router-dom';

// Creates a deal from an OPEN lead (POST /deals {leadId, unitId?}).
// The backend converts the lead in-transaction; a non-OPEN lead yields 409.
// No contact picker: contact is derived from the lead server-side.
export function CreateDealButton({ onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="deal" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>New deal</Button>
      <CreateDealDialog open={open} onClose={() => setOpen(false)} onCreated={onCreated} />
    </PermissionGate>
  );
}

export function CreateDealDialog({ open, onClose, onCreated }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [leadId, setLeadId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api('/deals', {
        method: 'POST',
        body: { leadId: leadId.trim(), unitId: unitId.trim() === '' ? null : unitId.trim() },
      });
      push('Deal created at NEW; lead converted.', 'success');
      onCreated?.(res);
      onClose();
      navigate(`/app/deals/${res.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="New deal"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Creating…' : 'Create deal'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Source lead ID" hint="Must be an OPEN lead. It converts to CONVERTED in the same transaction.">
          <Input value={leadId} onChange={(e) => { setLeadId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Unit ID (optional)" hint="Attach a unit now, or leave empty and attach later from the deal.">
          <Input value={unitId} onChange={(e) => { setUnitId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
