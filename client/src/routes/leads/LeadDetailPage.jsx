import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, prettifyEnum, shortId } from '../../lib/format';
import { validLeadTransitions } from '../../lib/leadWorkflow';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ReassignDialog({ open, onClose, leadId, onDone }) {
  const { api } = useAuth();
  const [agentId, setAgentId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api(`/leads/${leadId}/reassign`, { method: 'POST', body: { assignedAgentId: agentId.trim() } });
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
      title="Reassign lead"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Reassigning…' : 'Reassign'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field
          label="New assignee (user ID)"
          hint="Must be an ACTIVE user in your organization. Paste the agent's user ID — a user directory is a known gap."
        >
          <Input value={agentId} onChange={(e) => { setAgentId(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { push } = useToast();
  const { data: lead, error, loading, retry } = useApi(`/leads/${id}`);
  const maps = useRelatedNames(lead ? [lead] : null, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'originEnquiryId', kind: 'enquiry' },
  ]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [mutating, setMutating] = useState(false);

  async function transitionTo(target) {
    setMutating(true);
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { status: target } });
      push(`Lead moved to ${prettifyEnum(target)}.`, 'success');
      retry();
    } catch (err) {
      push(err.message || 'Transition failed.', 'error');
    } finally {
      setMutating(false);
    }
  }

  async function onDelete() {
    setMutating(true);
    try {
      await api(`/leads/${id}`, { method: 'DELETE' });
      push('Lead archived.', 'success');
      navigate('/app/leads');
    } catch (err) {
      push(err.message || 'Could not archive lead.', 'error');
      setMutating(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Lead" title="Loading…" />
        <Skeleton lines={6} />
      </PageShell>
    );
  }
  if (error || !lead) {
    return (
      <PageShell>
        <PageHeader eyebrow="Lead" title="Lead not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  const validTargets = validLeadTransitions(lead.status);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Lead"
        title={`Lead ${shortId(lead.id)}`}
        description="Working sales opportunity. Status moves only through the valid transitions below."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/leads">← All leads</Link>
            <PermissionGate resource="lead" action="assign">
              <Button variant="secondary" onClick={() => setReassignOpen(true)}>Reassign</Button>
            </PermissionGate>
            <PermissionGate resource="lead" action="delete">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Archive</Button>
            </PermissionGate>
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Status"><StatusBadge status={lead.status} /></Row>
            <Row label="Contact"><RelatedName kind="contact" id={lead.contactId} maps={maps} /></Row>
            <Row label="Project"><RelatedName kind="project" id={lead.projectId} maps={maps} /></Row>
            <Row label="Assignee">
              {lead.assignedAgentId ? <span title={lead.assignedAgentId}>{shortId(lead.assignedAgentId)}</span> : <span className="muted">Unassigned</span>}
              {lead.assignmentSource && <span className="muted"> · {prettifyEnum(lead.assignmentSource)}</span>}
            </Row>
            <Row label="Origin enquiry">
              <RelatedName kind="enquiry" id={lead.originEnquiryId} maps={maps} />
            </Row>
            <Row label="Created">{formatDateTime(lead.createdAt)}</Row>
          </dl>
        </Card>

        <Card title="Status">
          {validTargets.length === 0 ? (
            <p className="muted">CONVERTED is terminal — this lead has no further transitions.</p>
          ) : (
            <div className="merge-pick">
              {validTargets.map((t) => (
                <Button key={t} variant="secondary" disabled={mutating} onClick={() => transitionTo(t)}>
                  Move to {prettifyEnum(t)}
                </Button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Linked enquiries">
          <LinkedEnquiries leadId={id} />
        </Card>

        <Card title="Deals">
          <LeadDeals leadId={id} />
        </Card>
      </div>

      <ReassignDialog open={reassignOpen} onClose={() => setReassignOpen(false)} leadId={id} onDone={() => { retry(); push('Lead reassigned.', 'success'); }} />
      <ConfirmDialog
        open={deleteOpen}
        title="Archive lead"
        message="The lead will be soft-archived and hidden from lists. Its origin enquiry and history are preserved."
        confirmLabel={mutating ? 'Archiving…' : 'Archive lead'}
        onClose={() => { if (!mutating) setDeleteOpen(false); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}

function LinkedEnquiries({ leadId }) {
  const { data, error, loading, retry } = useApi(`/enquiries?linkedLeadId=${leadId}&limit=20&offset=0`);
  const rows = data ?? null;
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (!rows || rows.length === 0) return <EmptyState title="No linked enquiries" message="Intake events attached to this lead will appear here." />;
  return (
    <Table
      columns={[
        { key: 'createdAt', label: 'Received', render: (r) => <EntityLink to={`/app/enquiries/${r.id}`}>{formatDateTime(r.createdAt)}</EntityLink> },
        { key: 'channel', label: 'Channel', render: (r) => prettifyEnum(r.channel) },
      ]}
      rows={rows}
      rowKey={(r) => r.id}
    />
  );
}

function LeadDeals({ leadId }) {
  const { data, error, loading, retry } = useApi(`/deals?leadId=${leadId}&limit=20&offset=0`);
  const rows = data ?? null;
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (!rows || rows.length === 0) return <EmptyState title="No deals yet" message="Deals convert from this lead in a later workflow." />;
  return (
    <Table
      columns={[
        { key: 'stage', label: 'Stage', render: (r) => <StatusBadge status={r.stage} /> },
        { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
      ]}
      rows={rows}
      rowKey={(r) => r.id}
    />
  );
}
