import { useMemo, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';

const CHANNELS = ['WALK_IN', 'PHONE', 'OWNED_FORM'];

// Manual intake (agent walk-in / phone / owned-form). Submits the real
// POST /enquiries pipeline with a generated Idempotency-Key — never a lead
// bypass. Outcome (match state, lead, duplicates) is shown, not assumed.
export default function IntakeDialog({ open, onClose, onCreated }) {
  const { api } = useAuth();
  const { push } = useToast();
  const [form, setForm] = useState({
    channel: 'WALK_IN',
    contactName: '',
    phone: '',
    email: '',
    projectId: '',
    leadSourceId: '',
    campaignId: '',
    unitTypePreference: '',
    budgetMin: '',
    budgetMax: '',
    possessionPreference: '',
    notes: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [outcome, setOutcome] = useState(null);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setError(null);
  };

  const optionalUuid = (v) => {
    const t = v.trim();
    return t === '' ? null : t;
  };
  const optionalText = (v) => {
    const t = v.trim();
    return t === '' ? null : t;
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api('/enquiries', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          channel: form.channel,
          contactName: optionalText(form.contactName),
          phone: optionalText(form.phone),
          email: optionalText(form.email),
          projectId: optionalUuid(form.projectId),
          leadSourceId: optionalUuid(form.leadSourceId),
          campaignId: optionalUuid(form.campaignId),
          requirement: {
            unitTypePreference: optionalText(form.unitTypePreference),
            budgetMin: form.budgetMin === '' ? null : Number(form.budgetMin),
            budgetMax: form.budgetMax === '' ? null : Number(form.budgetMax),
            possessionPreference: optionalText(form.possessionPreference),
            notes: optionalText(form.notes),
          },
        },
      });
      setOutcome(res);
      push(res.lead ? 'Enquiry logged and linked to a lead.' : 'Enquiry logged as unmatched for review.', 'success');
      onCreated?.(res);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  const details = useMemo(() => {
    if (!error) return null;
    if (error.details) {
      try {
        return JSON.stringify(error.details);
      } catch {
        return null;
      }
    }
    return null;
  }, [error]);

  return (
    <Dialog
      open={open}
      title="Log enquiry"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {outcome ? 'Close' : 'Cancel'}
          </Button>
          {!outcome && (
            <Button variant="primary" onClick={onSubmit} disabled={pending}>
              {pending ? 'Logging…' : 'Log enquiry'}
            </Button>
          )}
        </>
      }
    >
      {outcome ? (
        <div className="intake-outcome">
          <p>
            <strong>Match:</strong> {outcome.contactMatch}
            {outcome.contactCreated ? ' (new contact created)' : ''}
          </p>
          <p>
            <strong>Lead:</strong>{' '}
            {outcome.lead ? `linked (${outcome.lead.status})` : 'none — preserved as unmatched'}
          </p>
          {outcome.possibleDuplicates && outcome.possibleDuplicates.length > 0 && (
            <p>
              <strong>Possible duplicates flagged:</strong> {outcome.possibleDuplicates.length} (review in
              Contacts → Duplicates)
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="form-grid">
          <Field label="Channel">
            <Select value={form.channel} onChange={set('channel')}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contact name">
            <Input value={form.contactName} onChange={set('contactName')} placeholder="Required when phone/email given" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set('phone')} placeholder="10-digit mobile" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Project ID" hint="Optional UUID — links the enquiry to a project">
            <Input value={form.projectId} onChange={set('projectId')} placeholder="UUID" />
          </Field>
          <Field label="Requirement: unit type">
            <Input value={form.unitTypePreference} onChange={set('unitTypePreference')} placeholder="e.g. 2BHK" />
          </Field>
          <Field label="Requirement: budget min">
            <Input type="number" min="0" value={form.budgetMin} onChange={set('budgetMin')} />
          </Field>
          <Field label="Requirement: budget max">
            <Input type="number" min="0" value={form.budgetMax} onChange={set('budgetMax')} />
          </Field>
          <Field label="Requirement: notes">
            <Textarea value={form.notes} onChange={set('notes')} />
          </Field>
          {error && <ErrorState message={error.message} details={details} />}
        </form>
      )}
    </Dialog>
  );
}

export function LogEnquiryButton({ onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="enquiry" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Log enquiry
      </Button>
      <IntakeDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(res) => {
          onCreated?.(res);
        }}
      />
    </PermissionGate>
  );
}
