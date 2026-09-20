import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { ErrorState, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney } from '../../lib/format';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EditUnitDialog({ open, onClose, unit, onSaved }) {
  const { api } = useAuth();
  const [identifier, setIdentifier] = useState(unit?.identifier ?? '');
  const [totalCost, setTotalCost] = useState(unit?.totalCost ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      // NOTE: availabilityStatus and projectId are deliberately absent —
      // the backend rejects them (400). Availability is workflow-owned.
      await api(`/units/${unit.id}`, {
        method: 'PATCH',
        body: {
          identifier: identifier.trim(),
          totalCost: totalCost === '' || totalCost == null ? null : Number(totalCost),
        },
      });
      onSaved();
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
      title="Edit unit"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save unit'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Identifier" hint="Unique within its project">
          <Input value={identifier} onChange={(e) => { setIdentifier(e.target.value); setError(null); }} required maxLength={50} />
        </Field>
        <Field label="Total cost">
          <Input type="number" min="0" value={totalCost ?? ''} onChange={(e) => { setTotalCost(e.target.value); setError(null); }} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function UnitDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { push } = useToast();
  const { data: unit, error, loading, retry } = useApi(`/units/${id}`);
  const maps = useRelatedNames(unit ? [unit] : null, [{ key: 'projectId', kind: 'project' }]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/units/${id}`, { method: 'DELETE' });
      push('Unit archived.', 'success');
      navigate('/app/properties/inventory');
    } catch (err) {
      push(err.message || 'Could not archive unit.', 'error');
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Unit" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !unit) {
    return (
      <PageShell>
        <PageHeader eyebrow="Unit" title="Unit not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Unit"
        title={unit.identifier}
        description="Availability changes only through reservation workflows."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/properties/inventory">← All units</Link>
            {unit.availabilityStatus === 'AVAILABLE' && (
              <PermissionGate resource="reservation" action="create">
                <Link className="btn btn--primary btn--md" to={`/app/reservations?create=1&unitId=${unit.id}`}>Reserve / Hold</Link>
              </PermissionGate>
            )}
            <PermissionGate resource="unit" action="update">
              <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
            </PermissionGate>
            <PermissionGate resource="unit" action="delete">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Archive</Button>
            </PermissionGate>
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Project"><RelatedName kind="project" id={unit.projectId} maps={maps} /></Row>
            <Row label="Availability"><StatusBadge status={unit.availabilityStatus} /></Row>
            <Row label="Total cost">{formatMoney(unit.totalCost)}</Row>
            <Row label="Created">{formatDateTime(unit.createdAt)}</Row>
            <Row label="Updated">{formatDateTime(unit.updatedAt)}</Row>
          </dl>
        </Card>
        <Card title="Deals">
          <UnitDeals unitId={id} />
        </Card>
      </div>
      <EditUnitDialog open={editOpen} onClose={() => setEditOpen(false)} unit={unit} onSaved={() => { retry(); push('Unit updated.', 'success'); }} />
      <ConfirmDialog
        open={deleteOpen}
        title="Archive unit"
        message="The unit will be soft-archived. Linked history is preserved."
        confirmLabel={busy ? 'Archiving…' : 'Archive unit'}
        onClose={() => { if (!busy) setDeleteOpen(false); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}

function UnitDeals({ unitId }) {
  const { data, error, loading, retry } = useApi(`/deals?unitId=${unitId}&limit=20&offset=0`);
  const rows = data ?? null;
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (!rows || rows.length === 0) return <p className="muted">No deals reference this unit yet.</p>;
  return (
    <Table
      columns={[
        { key: 'id', label: 'Deal', render: (r) => <EntityLink to={`/app/deals/${r.id}`}>Open deal</EntityLink> },
        { key: 'stage', label: 'Stage', render: (r) => <StatusBadge status={r.stage} /> },
        { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
      ]}
      rows={rows}
      rowKey={(r) => r.id}
    />
  );
}
