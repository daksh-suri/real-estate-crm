import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { FilterBar, SearchInput } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';

function LeadSourceDialog({ open, onClose, source, onSaved }) {
  const { api } = useAuth();
  const [name, setName] = useState(source?.name ?? '');
  const [type, setType] = useState(source?.type ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const body = { name: name.trim(), type: type.trim() === '' ? null : type.trim() };
      const path = source ? `/lead-sources/${source.id}` : '/lead-sources';
      await api(path, { method: source ? 'PATCH' : 'POST', body });
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
      title={source ? 'Edit lead source' : 'New lead source'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save source'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} />
        </Field>
        <Field label="Type (optional)" hint="Free-form label, e.g. PORTAL, REFERRAL.">
          <Input value={type} onChange={(e) => { setType(e.target.value); setError(null); }} maxLength={50} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function LeadSourcesPage() {
  const { search, limit, offset, setSearch, setPage } = useUrlListState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { api } = useAuth();
  const { push } = useToast();

  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) q.set('search', search);
  const { data, error, loading, retry } = useApi(`/lead-sources?${q.toString()}`);
  const rows = data ?? null;

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/lead-sources/${deleting.id}`, { method: 'DELETE' });
      push('Lead source deleted. Linked leads keep working with no source.', 'success');
      setDeleting(null);
      retry();
    } catch (err) {
      push(err.message || 'Could not delete lead source.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => r.name },
    { key: 'type', label: 'Type', render: (r) => r.type || <span className="muted">—</span> },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <span className="row-actions">
          <PermissionGate resource="leadSource" action="update">
            <Button variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
          </PermissionGate>
          <PermissionGate resource="leadSource" action="delete">
            <Button variant="ghost" onClick={() => setDeleting(r)}>Delete</Button>
          </PermissionGate>
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Lead sources"
        description="Where enquiries come from. Deleting a source unlinks it from history; past leads are preserved."
        actions={
          <PermissionGate resource="leadSource" action="create">
            <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>New source</Button>
          </PermissionGate>
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search sources…" />
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title={search ? 'No sources match this search' : 'No lead sources yet'}
                message={search ? 'Try a different search.' : 'Create the first source to attribute intake.'}
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      <LeadSourceDialog
        open={dialogOpen}
        source={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={() => { retry(); push(editing ? 'Lead source updated.' : 'Lead source created.', 'success'); }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete lead source"
        message={`Delete "${deleting?.name}"? Linked leads and campaigns keep working with no source attached.`}
        confirmLabel={busy ? 'Deleting…' : 'Delete source'}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}
