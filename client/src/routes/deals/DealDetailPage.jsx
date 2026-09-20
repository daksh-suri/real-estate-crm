import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Textarea } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, prettifyEnum, shortId } from '../../lib/format';
import { dealStageNeedsReason, validDealTransitions } from '../../lib/dealWorkflow';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TransitionDialog({ open, onClose, deal, target, onDone }) {
  const { api } = useAuth();
  const needsReason = dealStageNeedsReason(target);
  const [lostReason, setLostReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // fromStage carries the concurrency check: a moved-on deal yields 409,
      // never a silent overwrite.
      await api(`/deals/${deal.id}/stage-transition`, {
        method: 'POST',
        body: { stage: target, lostReason: needsReason ? lostReason.trim() : null, fromStage: deal.stage },
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
      title={`Move to ${prettifyEnum(target)}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Moving…' : 'Confirm move'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <p className="muted">
          From <strong>{prettifyEnum(deal.stage)}</strong> to <strong>{prettifyEnum(target)}</strong>. This writes
          deal history and cannot be undone from here.
        </p>
        {needsReason && (
          <Field label="Lost reason" hint="Required when closing a deal as lost.">
            <Textarea value={lostReason} onChange={(e) => { setLostReason(e.target.value); setError(null); }} required maxLength={500} />
          </Field>
        )}
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function AttachUnitDialog({ open, onClose, dealId, onDone }) {
  const { api } = useAuth();
  const [unitId, setUnitId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api(`/deals/${dealId}`, { method: 'PATCH', body: { unitId: unitId.trim() } });
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
      title="Attach unit"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Attaching…' : 'Attach unit'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Unit ID" hint="Attach-once: a deal bound to a unit can never be rebound. Availability is untouched.">
          <Input value={unitId} onChange={(e) => { setUnitId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function DealDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { push } = useToast();
  const { data: deal, error, loading, retry } = useApi(`/deals/${id}`);
  const maps = useRelatedNames(deal ? [deal] : null, [
    { key: 'contactId', kind: 'contact' },
    { key: 'leadId', kind: 'lead' },
  ]);
  const [target, setTarget] = useState(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/deals/${id}`, { method: 'DELETE' });
      push('Deal archived.', 'success');
      navigate('/app/deals');
    } catch (err) {
      push(err.message || 'Could not archive deal.', 'error');
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Deal" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !deal) {
    return (
      <PageShell>
        <PageHeader eyebrow="Deal" title="Deal not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  const validTargets = validDealTransitions(deal.stage);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Deal"
        title={`Deal ${shortId(deal.id)}`}
        description="Stage moves only through the valid transitions below — never by editing."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/deals">← All deals</Link>
            {!deal.unitId && (
              <PermissionGate resource="deal" action="update">
                <Button variant="secondary" onClick={() => setAttachOpen(true)}>Attach unit</Button>
              </PermissionGate>
            )}
            <PermissionGate resource="deal" action="delete">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Archive</Button>
            </PermissionGate>
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Stage"><StatusBadge status={deal.stage} /></Row>
            <Row label="Contact"><RelatedName kind="contact" id={deal.contactId} maps={maps} /></Row>
            <Row label="Lead"><RelatedName kind="lead" id={deal.leadId} maps={maps} /></Row>
            <Row label="Unit">
              {deal.unitId ? (
                <EntityLink to={`/app/properties/inventory/${deal.unitId}`}>Open unit</EntityLink>
              ) : (
                <span className="muted">Not attached</span>
              )}
            </Row>
            {deal.stage === 'CLOSED_LOST' && <Row label="Lost reason">{deal.lostReason || '—'}</Row>}
            <Row label="Created">{formatDateTime(deal.createdAt)}</Row>
            <Row label="Updated">{formatDateTime(deal.updatedAt)}</Row>
          </dl>
        </Card>

        <Card title="Stage transition">
          {validTargets.length === 0 ? (
            <p className="muted">Terminal stage — this deal has no further transitions.</p>
          ) : (
            <PermissionGate resource="deal" action="transition" fallback={<p className="muted">You lack permission to transition this deal.</p>}>
              <div className="merge-pick">
                {validTargets.map((t) => (
                  <Button key={t} variant="secondary" onClick={() => setTarget(t)}>
                    Move to {prettifyEnum(t)}
                  </Button>
                ))}
              </div>
            </PermissionGate>
          )}
        </Card>
      </div>

      {target && (
        <TransitionDialog
          open
          deal={deal}
          target={target}
          onClose={() => setTarget(null)}
          onDone={(t) => { retry(); push(`Deal moved to ${prettifyEnum(t)}.`, 'success'); }}
        />
      )}
      <AttachUnitDialog open={attachOpen} onClose={() => setAttachOpen(false)} dealId={id} onDone={() => { retry(); push('Unit attached.', 'success'); }} />
      <ConfirmDialog
        open={deleteOpen}
        title="Archive deal"
        message="The deal will be soft-archived. Its lead and history are preserved."
        confirmLabel={busy ? 'Archiving…' : 'Archive deal'}
        onClose={() => { if (!busy) setDeleteOpen(false); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}
