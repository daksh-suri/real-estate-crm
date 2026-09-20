import { useState } from 'react';
import { Button, Field, Input, Textarea } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { fromInputValue } from '../../lib/format';

// Logs an activity with an OPTIONAL follow-up task in ONE backend operation
// (POST /activities {…, followUpTask?}). The checkbox explicitly states the
// atomicity: both records succeed or fail together — never activity-then-task.
export function LogActivityButton({ contactId, leadId, dealId, onLogged }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="activity" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Log activity</Button>
      {open && (
        <LogActivityDialog
          contactId={contactId}
          leadId={leadId}
          dealId={dealId}
          onClose={() => setOpen(false)}
          onLogged={onLogged}
        />
      )}
    </PermissionGate>
  );
}

export function LogActivityDialog({ contactId: presetContactId, leadId: presetLeadId, dealId: presetDealId, onClose, onLogged }) {
  const { api } = useAuth();
  const { push } = useToast();
  const idempotencyKey = useIdempotencyKey();
  const [contactId, setContactId] = useState(presetContactId ?? '');
  const [leadId, setLeadId] = useState(presetLeadId ?? '');
  const [dealId, setDealId] = useState(presetDealId ?? '');
  const [type, setType] = useState('');
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [assignedTo, setAssignedTo] = useState('');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const opt = (v) => (v.trim() === '' ? null : v.trim());

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const body = {
        contactId: contactId.trim(),
        leadId: opt(leadId),
        dealId: opt(dealId),
        type: type.trim(),
        outcome: opt(outcome),
        notes: opt(notes),
      };
      if (withFollowUp) {
        const due = fromInputValue(dueAt);
        if (!due) throw Object.assign(new Error('Follow-up needs a valid due date.'), { statusCode: 400 });
        body.followUpTask = {
          assignedTo: assignedTo.trim(),
          title: title.trim(),
          dueAt: due,
          relatedContactId: opt(contactId),
          relatedDealId: opt(dealId),
        };
      }
      const res = await api('/activities', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body,
      });
      push(withFollowUp ? 'Activity logged with follow-up task — one operation.' : 'Activity logged.', 'success');
      onLogged?.(res);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      title="Log activity"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Logging…' : 'Log activity'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Contact ID">
          <Input value={contactId} onChange={(e) => { setContactId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Lead ID (optional)">
          <Input value={leadId} onChange={(e) => { setLeadId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        <Field label="Deal ID (optional)">
          <Input value={dealId} onChange={(e) => { setDealId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        <Field label="Type" hint="Free-form, e.g. CALL, SITE_VISIT, WHATSAPP (max 50 chars).">
          <Input value={type} onChange={(e) => { setType(e.target.value); setError(null); }} required maxLength={50} />
        </Field>
        <Field label="Outcome (optional)" hint="Free-form, e.g. CONNECTED, NO_ANSWER.">
          <Input value={outcome} onChange={(e) => { setOutcome(e.target.value); setError(null); }} maxLength={50} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); setError(null); }} maxLength={5000} />
        </Field>
        <Field label="Follow-up">
          <label className="check-row">
            <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} />
            <span>Create a follow-up task in the same operation (both succeed or both fail).</span>
          </label>
        </Field>
        {withFollowUp && (
          <>
            <Field label="Assignee ID" hint="Must be an ACTIVE user in your organization.">
              <Input value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setError(null); }} placeholder="UUID" required={withFollowUp} />
            </Field>
            <Field label="Task title">
              <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} required={withFollowUp} maxLength={200} />
            </Field>
            <Field label="Due at">
              <Input type="datetime-local" value={dueAt} onChange={(e) => { setDueAt(e.target.value); setError(null); }} required={withFollowUp} />
            </Field>
          </>
        )}
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
