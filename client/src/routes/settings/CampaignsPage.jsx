import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';

function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function CampaignDialog({ open, onClose, campaign, sources, onSaved }) {
  const { api } = useAuth();
  const [name, setName] = useState(campaign?.name ?? '');
  const [leadSourceId, setLeadSourceId] = useState(campaign?.leadSourceId ?? '');
  const [startDate, setStartDate] = useState(toDateInput(campaign?.startDate));
  const [endDate, setEndDate] = useState(toDateInput(campaign?.endDate));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        leadSourceId: leadSourceId === '' ? null : leadSourceId,
        startDate: startDate === '' ? null : startDate,
        endDate: endDate === '' ? null : endDate,
      };
      const path = campaign ? `/campaigns/${campaign.id}` : '/campaigns';
      await api(path, { method: campaign ? 'PATCH' : 'POST', body });
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
      title={campaign ? 'Edit campaign' : 'New campaign'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save campaign'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} />
        </Field>
        <Field label="Lead source (optional)">
          <Select value={leadSourceId} onChange={(e) => { setLeadSourceId(e.target.value); setError(null); }}>
            <option value="">No source</option>
            {(sources || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Start date (optional)">
          <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setError(null); }} />
        </Field>
        <Field label="End date (optional)">
          <Input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setError(null); }} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function CampaignsPage() {
  const { search, limit, offset, setSearch, setPage } = useUrlListState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { api } = useAuth();
  const { push } = useToast();

  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) q.set('search', search);
  const { data, error, loading, retry } = useApi(`/campaigns?${q.toString()}`);
  const rows = data ?? null;
  const sourcesQuery = useApi('/lead-sources?limit=100&offset=0');
  const sources = sourcesQuery.data ?? [];

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/campaigns/${deleting.id}`, { method: 'DELETE' });
      push('Campaign deleted. Linked leads keep working with no campaign.', 'success');
      setDeleting(null);
      retry();
    } catch (err) {
      push(err.message || 'Could not delete campaign.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function sourceName(id) {
    const s = (sources || []).find((x) => x.id === id);
    return s ? s.name : null;
  }

  const columns = [
    { key: 'name', label: 'Name', render: (r) => r.name },
    {
      key: 'leadSourceId',
      label: 'Lead source',
      render: (r) => (r.leadSourceId
        ? (sourceName(r.leadSourceId) ? <EntityLink to={`/app/settings/lead-sources`}>{sourceName(r.leadSourceId)}</EntityLink> : <span className="muted">—</span>)
        : <span className="muted">—</span>),
    },
    { key: 'startDate', label: 'Starts', render: (r) => (r.startDate ? formatDateTime(r.startDate) : <span className="muted">—</span>) },
    { key: 'endDate', label: 'Ends', render: (r) => (r.endDate ? formatDateTime(r.endDate) : <span className="muted">—</span>) },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <span className="row-actions">
          <PermissionGate resource="campaign" action="update">
            <Button variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
          </PermissionGate>
          <PermissionGate resource="campaign" action="delete">
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
        title="Campaigns"
        description="Marketing campaigns for intake attribution. Deleting a campaign unlinks it; past leads are preserved."
        actions={
          <PermissionGate resource="campaign" action="create">
            <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>New campaign</Button>
          </PermissionGate>
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" />
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
                title={search ? 'No campaigns match this search' : 'No campaigns yet'}
                message={search ? 'Try a different search.' : 'Create the first campaign to tag intake.'}
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      <CampaignDialog
        open={dialogOpen}
        campaign={editing}
        sources={sources}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={() => { retry(); push(editing ? 'Campaign updated.' : 'Campaign created.', 'success'); }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete campaign"
        message={`Delete "${deleting?.name}"? Linked leads keep working with no campaign attached.`}
        confirmLabel={busy ? 'Deleting…' : 'Delete campaign'}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}
