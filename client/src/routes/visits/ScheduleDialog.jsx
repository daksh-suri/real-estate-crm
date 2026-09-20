import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { fromInputValue, toInputValue } from '../../lib/format';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';

// Schedules a visit through POST /site-visits (idempotency-keyed). The
// backend owns slot conflicts transactionally — a 409 here means the slot
// was taken, never a client-side availability claim.
export function ScheduleVisitButton({ onScheduled, defaults = {} }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="siteVisit" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Schedule visit</Button>
      <ScheduleDialog open={open} onClose={() => setOpen(false)} onScheduled={onScheduled} defaults={defaults} />
    </PermissionGate>
  );
}

export function ScheduleDialog({ open, onClose, onScheduled, defaults = {} }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const [agentId, setAgentId] = useState(defaults.agentId ?? '');
  const [projectId, setProjectId] = useState(defaults.projectId ?? '');
  const [contactId, setContactId] = useState(defaults.contactId ?? '');
  const [dealId, setDealId] = useState(defaults.dealId ?? '');
  const [scheduledAt, setScheduledAt] = useState(toInputValue(defaults.scheduledAt ?? ''));
  const [durationMinutes, setDurationMinutes] = useState(defaults.durationMinutes ?? '60');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  // Stable per mount: retrying a timed-out submit replays the same schedule.
  const idempotencyKey = useIdempotencyKey();

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const iso = fromInputValue(scheduledAt);
      if (!iso) throw Object.assign(new Error('Choose a valid date and time.'), { statusCode: 400 });
      const res = await api('/site-visits', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          agentId: agentId.trim(),
          projectId: projectId.trim(),
          contactId: contactId.trim(),
          dealId: dealId.trim() === '' ? null : dealId.trim(),
          scheduledAt: iso,
          durationMinutes: durationMinutes === '' ? undefined : Number(durationMinutes),
        },
      });
      const visit = res.siteVisit ?? res;
      push('Visit scheduled.', 'success');
      onScheduled?.(visit);
      onClose();
      navigate(`/app/site-visits/${visit.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Schedule visit"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Scheduling…' : 'Schedule visit'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Agent ID" hint="Must be an ACTIVE user in your organization.">
          <Input value={agentId} onChange={(e) => { setAgentId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Project ID">
          <Input value={projectId} onChange={(e) => { setProjectId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Contact ID">
          <Input value={contactId} onChange={(e) => { setContactId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Deal ID (optional)" hint="Must belong to the same contact when given.">
          <Input value={dealId} onChange={(e) => { setDealId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        <Field label="Scheduled at">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => { setScheduledAt(e.target.value); setError(null); }} required />
        </Field>
        <Field label="Duration (minutes)" hint="15–480. Defaults to 60.">
          <Input type="number" min={15} max={480} value={durationMinutes} onChange={(e) => { setDurationMinutes(e.target.value); setError(null); }} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
