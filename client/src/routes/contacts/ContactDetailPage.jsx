import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Badge, Button, Card, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney, prettifyEnum } from '../../lib/format';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Section({ title, path, emptyTitle, emptyMessage, columns, rowKey }) {
  const { data, error, loading, retry } = useApi(path);
  const rows = data ?? null;
  if (loading) return <Card title={title}><Skeleton lines={2} /></Card>;
  if (error) return <Card title={title}><ErrorState message={error.message} onRetry={retry} /></Card>;
  if (!rows || rows.length === 0) {
    return (
      <Card title={title}>
        <EmptyState title={emptyTitle} message={emptyMessage} />
      </Card>
    );
  }
  return (
    <Card title={title}>
      <Table columns={columns} rows={rows} rowKey={rowKey} />
    </Card>
  );
}

function EditDialog({ open, onClose, contact, onSaved }) {
  const { api } = useAuth();
  const [form, setForm] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const current = form ?? {
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    communicationConsent: contact.communicationConsent ?? 'OPTED_IN',
  };
  const set = (key) => (e) => {
    setForm((f) => ({ ...(f ?? current), [key]: e.target.value }));
    setError(null);
  };
  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const trim = (v) => (v.trim() === '' ? null : v.trim());
      await api(`/contacts/${contact.id}`, {
        method: 'PATCH',
        body: { name: current.name.trim(), phone: trim(current.phone), email: trim(current.email), communicationConsent: current.communicationConsent },
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
      title="Edit contact"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={current.name} onChange={set('name')} required />
        </Field>
        <Field label="Phone">
          <Input value={current.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={current.email} onChange={set('email')} />
        </Field>
        <Field label="Communication consent">
          <Select value={current.communicationConsent} onChange={set('communicationConsent')}>
            <option value="OPTED_IN">Opted in</option>
            <option value="OPTED_OUT">Opted out</option>
          </Select>
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { push } = useToast();
  const { data: contact, error, loading, retry } = useApi(`/contacts/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    setDeleting(true);
    try {
      await api(`/contacts/${id}`, { method: 'DELETE' });
      push('Contact archived.', 'success');
      navigate('/app/contacts');
    } catch (err) {
      push(err.message || 'Could not archive contact.', 'error');
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Contact" title="Loading…" />
        <Skeleton lines={6} />
      </PageShell>
    );
  }
  if (error || !contact) {
    return (
      <PageShell>
        <PageHeader eyebrow="Contact" title="Contact not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contact"
        title={contact.name}
        description={`${contact.phone || 'No phone'} · ${contact.email || 'No email'}`}
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/contacts">← All contacts</Link>
            <PermissionGate resource="contact" action="update">
              <Button variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
            </PermissionGate>
            <PermissionGate resource="contact" action="delete">
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>Archive</Button>
            </PermissionGate>
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Consent"><Badge tone={contact.communicationConsent === 'OPTED_IN' ? 'success' : 'warning'}>{prettifyEnum(contact.communicationConsent)}</Badge></Row>
            <Row label="Created">{formatDateTime(contact.createdAt)}</Row>
          </dl>
        </Card>

        <RequirementsSection contactId={id} />

        <Section
          title="Enquiries"
          path={`/enquiries?contactId=${id}&limit=20&offset=0`}
          emptyTitle="No enquiries recorded"
          emptyMessage="Intake events for this contact will appear here."
          rowKey={(r) => r.id}
          columns={[
            { key: 'createdAt', label: 'Received', render: (r) => <EntityLink to={`/app/enquiries/${r.id}`}>{formatDateTime(r.createdAt)}</EntityLink> },
            { key: 'channel', label: 'Channel', render: (r) => <Badge tone="info">{r.channel}</Badge> },
            { key: 'linkedLeadId', label: 'Lead', render: (r) => (r.linkedLeadId ? <EntityLink to={`/app/leads/${r.linkedLeadId}`}>Open lead</EntityLink> : <span className="muted">—</span>) },
          ]}
        />

        <LeadsSection contactId={id} />

        <Section
          title="Deals"
          path={`/deals?contactId=${id}&limit=20&offset=0`}
          emptyTitle="No deals yet"
          emptyMessage="Deals convert from open leads in a later workflow."
          rowKey={(r) => r.id}
          columns={[
            { key: 'stage', label: 'Stage', render: (r) => <StatusBadge status={r.stage} /> },
            { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
          ]}
        />
      </div>

      <EditDialog open={editOpen} onClose={() => setEditOpen(false)} contact={contact} onSaved={() => { retry(); push('Contact updated.', 'success'); }} />
      <ConfirmDialog
        open={deleteOpen}
        title="Archive contact"
        message="The contact will be soft-archived and hidden from lists. Intake and sales history is preserved."
        confirmLabel={deleting ? 'Archiving…' : 'Archive contact'}
        onClose={() => { if (!deleting) setDeleteOpen(false); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}

function RequirementsSection({ contactId }) {
  const { data, error, loading, retry } = useApi(`/contacts/${contactId}/requirements`);
  const rows = data ?? null;
  if (loading) return <Card title="Requirements"><Skeleton lines={2} /></Card>;
  if (error) return <Card title="Requirements"><ErrorState message={error.message} onRetry={retry} /></Card>;
  if (!rows || rows.length === 0) {
    return <Card title="Requirements"><EmptyState title="No requirements recorded" message="Stated customer needs land here via intake." /></Card>;
  }
  return (
    <Card title="Requirements">
      <Table
        columns={[
          { key: 'unitTypePreference', label: 'Type', render: (r) => r.unitTypePreference || <span className="muted">—</span> },
          { key: 'budget', label: 'Budget', render: (r) => `${formatMoney(r.budgetMin)} – ${formatMoney(r.budgetMax)}` },
          { key: 'possessionPreference', label: 'Possession', render: (r) => r.possessionPreference || <span className="muted">—</span> },
          { key: 'notes', label: 'Notes', render: (r) => r.notes || <span className="muted">—</span> },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />
    </Card>
  );
}

function LeadsSection({ contactId }) {
  const { data, error, loading, retry } = useApi(`/leads?contactId=${contactId}&limit=20&offset=0`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [{ key: 'projectId', kind: 'project' }]);
  if (loading) return <Card title="Leads"><Skeleton lines={2} /></Card>;
  if (error) return <Card title="Leads"><ErrorState message={error.message} onRetry={retry} /></Card>;
  if (!rows || rows.length === 0) {
    return <Card title="Leads"><EmptyState title="No leads yet" message="Working sales opportunities for this contact will appear here." /></Card>;
  }
  return (
    <Card title="Leads">
      <Table
        columns={[
          { key: 'id', label: 'Lead', render: (r) => <EntityLink to={`/app/leads/${r.id}`}>Open lead</EntityLink> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={maps} /> },
          { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />
    </Card>
  );
}
