import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';
import { ProjectUnitsCard } from './ProjectsPage';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CreateUnitDialog({ open, onClose, projectId, onCreated }) {
  const { api } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api(`/projects/${projectId}/units`, {
        method: 'POST',
        body: {
          identifier: identifier.trim(),
          totalCost: totalCost === '' ? null : Number(totalCost),
        },
      });
      onCreated();
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
      title="Add unit"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Adding…' : 'Add unit'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Identifier" hint="Unique within this project, e.g. A-1204">
          <Input value={identifier} onChange={(e) => { setIdentifier(e.target.value); setError(null); }} required maxLength={50} />
        </Field>
        <Field label="Total cost (optional)">
          <Input type="number" min="0" value={totalCost} onChange={(e) => { setTotalCost(e.target.value); setError(null); }} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { data: project, error, loading, retry } = useApi(`/projects/${id}`);
  const [unitOpen, setUnitOpen] = useState(false);
  const { push } = useToast();
  // Bump to refetch the nested units card after a create.
  const [unitsTick, setUnitsTick] = useState(0);

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Project" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !project) {
    return (
      <PageShell>
        <PageHeader eyebrow="Project" title="Project not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={project.location || 'No location recorded.'}
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/properties/projects">← All projects</Link>
            <PermissionGate resource="unit" action="create">
              <Button variant="primary" onClick={() => setUnitOpen(true)}>Add unit</Button>
            </PermissionGate>
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Status"><StatusBadge status={project.status} /></Row>
            <Row label="Location">{project.location || '—'}</Row>
            <Row label="Created">{formatDateTime(project.createdAt)}</Row>
            <Row label="Updated">{formatDateTime(project.updatedAt)}</Row>
          </dl>
        </Card>
        <div key={unitsTick}>
          <ProjectUnitsCard projectId={id} />
        </div>
      </div>
      <CreateUnitDialog
        open={unitOpen}
        onClose={() => setUnitOpen(false)}
        projectId={id}
        onCreated={() => { setUnitsTick((t) => t + 1); push('Unit added.', 'success'); }}
      />
    </PageShell>
  );
}

export function UnitAvailabilityNote() {
  return (
    <p className="muted">
      Availability is backend-authoritative and changes only through reservation workflows — it cannot be edited here.
    </p>
  );
}
