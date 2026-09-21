import { useEffect, useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput, StatusBadge } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';

const PROJECT_STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];

function ProjectDialog({ open, onClose, project, onSaved }) {
  const { api } = useAuth();
  const [name, setName] = useState(project?.name ?? '');
  const [location, setLocation] = useState(project?.location ?? '');
  const [status, setStatus] = useState(project?.status ?? 'ACTIVE');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '');
      setLocation(project?.location ?? '');
      setStatus(project?.status ?? 'ACTIVE');
      setError(null);
    }
  }, [open, project]);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const body = { name: name.trim(), location: location.trim() === '' ? null : location.trim() };
      if (!project) body.status = status;
      else if (status !== project.status) body.status = status;
      const path = project ? `/projects/${project.id}` : '/projects';
      await api(path, { method: project ? 'PATCH' : 'POST', body });
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
      title={project ? 'Edit project' : 'New project'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save project'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} />
        </Field>
        <Field label="Location">
          <Input value={location} onChange={(e) => { setLocation(e.target.value); setError(null); }} maxLength={200} />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { search, limit, offset, setSearch, setPage } = useUrlListState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { api } = useAuth();
  const { push } = useToast();

  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) q.set('search', search);
  const { data, error, loading, retry } = useApi(`/projects?${q.toString()}`);
  const rows = data ?? null;

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/projects/${deleting.id}`, { method: 'DELETE' });
      push('Project archived.', 'success');
      setDeleting(null);
      retry();
    } catch (err) {
      push(err.message || 'Could not archive project.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'name', label: 'Project', render: (r) => <EntityLink to={`/app/properties/projects/${r.id}`}>{r.name}</EntityLink> },
    { key: 'location', label: 'Location', render: (r) => r.location || <span className="muted">—</span> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <span className="row-actions">
          <PermissionGate resource="project" action="update">
            <Button variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
          </PermissionGate>
          <PermissionGate resource="project" action="delete">
            <Button variant="ghost" onClick={() => setDeleting(r)}>Archive</Button>
          </PermissionGate>
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Property"
        title="Projects"
        description="Developments that carry inventory. Units live under a project and never move between projects."
        actions={
          <PermissionGate resource="project" action="create">
            <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>New project</Button>
          </PermissionGate>
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
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
                title={search ? 'No projects match this search' : 'No projects yet'}
                message={search ? 'Try a different search.' : 'Create the first project to start building inventory.'}
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      <ProjectDialog
        open={dialogOpen}
        project={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={() => { retry(); push(editing ? 'Project updated.' : 'Project created.', 'success'); }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Archive project"
        message={`Archive "${deleting?.name}"? It stays in history; units remain attached and readable.`}
        confirmLabel={busy ? 'Archiving…' : 'Archive project'}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}

export function ProjectUnitsCard({ projectId }) {
  const { data, error, loading, retry } = useApi(`/projects/${projectId}/units`);
  const rows = data ?? null;
  if (loading) return <Card title="Units"><Skeleton lines={3} /></Card>;
  if (error) return <Card title="Units"><ErrorState message={error.message} onRetry={retry} /></Card>;
  return (
    <Card title={`Units (${rows ? rows.length : 0})`}>
      <Table
        columns={[
          { key: 'identifier', label: 'Unit', render: (r) => <EntityLink to={`/app/properties/inventory/${r.id}`}>{r.identifier}</EntityLink> },
          { key: 'availabilityStatus', label: 'Availability', render: (r) => <StatusBadge status={r.availabilityStatus} /> },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No units yet" message="Add the first unit to this project." />}
      />
    </Card>
  );
}
