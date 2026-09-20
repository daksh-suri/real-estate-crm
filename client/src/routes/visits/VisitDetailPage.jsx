import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Textarea } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, fromInputValue, prettifyEnum, shortId, toInputValue } from '../../lib/format';
import { canReschedule, validVisitTransitions, visitActionFor } from '../../lib/visitWorkflow';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function LifecycleDialog({ open, onClose, visit, target, onDone }) {
  const { api } = useAuth();
  const action = visitActionFor(target);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending || !action) return;
    setPending(true);
    setError(null);
    try {
      await api(`/site-visits/${visit.id}/${action.endpoint}`, {
        method: 'POST',
        body: action.needsReason ? { cancellationReason: reason.trim() } : {},
      });
      onDone(target);
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
      title={`${action?.label || 'Update'} visit`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : `Confirm ${action?.label || ''}`}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <p className="muted">
          From <strong>{prettifyEnum(visit.status)}</strong> to <strong>{prettifyEnum(target)}</strong>. History
          stays on the visit row.
        </p>
        {action?.needsReason && (
          <Field label="Cancellation reason" hint="Required to cancel a visit.">
            <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} required maxLength={500} />
          </Field>
        )}
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function RescheduleDialog({ open, onClose, visit, onDone }) {
  const { api } = useAuth();
  const [scheduledAt, setScheduledAt] = useState(toInputValue(visit.scheduledAt));
  const [durationMinutes, setDurationMinutes] = useState(String(visit.durationMinutes ?? 60));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const iso = fromInputValue(scheduledAt);
      if (!iso) throw Object.assign(new Error('Choose a valid date and time.'), { statusCode: 400 });
      await api(`/site-visits/${visit.id}/reschedule`, {
        method: 'POST',
        body: { scheduledAt: iso, durationMinutes: durationMinutes === '' ? undefined : Number(durationMinutes) },
      });
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
      title="Reschedule visit"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Rescheduling…' : 'Reschedule'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <p className="muted">The slot is re-checked transactionally — a conflict yields an error, never a silent double-book.</p>
        <Field label="New slot">
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => { setScheduledAt(e.target.value); setError(null); }} required />
        </Field>
        <Field label="Duration (minutes)" hint="15–480. Leave as-is to keep the current duration.">
          <Input type="number" min={15} max={480} value={durationMinutes} onChange={(e) => { setDurationMinutes(e.target.value); setError(null); }} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function VisitDetailPage() {
  const { id } = useParams();
  const { push } = useToast();
  const { data: visit, error, loading, retry } = useApi(`/site-visits/${id}`);
  const maps = useRelatedNames(visit ? [visit] : null, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'dealId', kind: 'deal' },
  ]);
  const [target, setTarget] = useState(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Site visit" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !visit) {
    return (
      <PageShell>
        <PageHeader eyebrow="Site visit" title="Visit not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  // dealId links to a Deal, but deal detail screens land later — show the id
  // reference without a dead link.
  const validTargets = validVisitTransitions(visit.status);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Site visit"
        title={`${formatDateTime(visit.scheduledAt)} · ${visit.durationMinutes}m`}
        description="Slot, customer, property, and lifecycle. Only valid actions are offered."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/site-visits">← All visits</Link>
            {canReschedule(visit.status) && (
              <PermissionGate resource="siteVisit" action="update">
                <Button variant="secondary" onClick={() => setRescheduleOpen(true)}>Reschedule</Button>
              </PermissionGate>
            )}
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Status"><StatusBadge status={visit.status} /></Row>
            <Row label="Contact"><RelatedName kind="contact" id={visit.contactId} maps={maps} /></Row>
            <Row label="Project"><RelatedName kind="project" id={visit.projectId} maps={maps} /></Row>
            <Row label="Agent"><span title={visit.agentId}>{shortId(visit.agentId)}</span></Row>
            <Row label="Deal">
              {visit.dealId ? (
                <RelatedName kind="deal" id={visit.dealId} maps={maps} />
              ) : (
                <span className="muted">None</span>
              )}
            </Row>
            {visit.status === 'CANCELLED' && (
              <>
                <Row label="Cancelled by"><span title={visit.cancelledBy}>{shortId(visit.cancelledBy)}</span></Row>
                <Row label="Reason">{visit.cancellationReason || '—'}</Row>
                <Row label="Cancelled at">{formatDateTime(visit.cancelledAt)}</Row>
              </>
            )}
            <Row label="Created">{formatDateTime(visit.createdAt)}</Row>
          </dl>
        </Card>

        <Card title="Lifecycle">
          {validTargets.length === 0 ? (
            <p className="muted">Terminal state — this visit has no further actions.</p>
          ) : (
            <PermissionGate resource="siteVisit" action="transition" fallback={<p className="muted">You lack permission to change this visit.</p>}>
              <div className="merge-pick">
                {validTargets.map((t) => (
                  <Button key={t} variant="secondary" onClick={() => setTarget(t)}>
                    {visitActionFor(t)?.label || prettifyEnum(t)}
                  </Button>
                ))}
              </div>
            </PermissionGate>
          )}
        </Card>
      </div>

      {target && (
        <LifecycleDialog
          open
          visit={visit}
          target={target}
          onClose={() => setTarget(null)}
          onDone={(t) => { retry(); push(`Visit ${prettifyEnum(t).toLowerCase()}.`, 'success'); }}
        />
      )}
      <RescheduleDialog open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} visit={visit} onDone={() => { retry(); push('Visit rescheduled.', 'success'); }} />
    </PageShell>
  );
}
