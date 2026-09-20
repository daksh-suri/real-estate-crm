import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Select } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, prettifyEnum, shortId } from '../../lib/format';
import { ReserveDialog } from './ReserveDialog';

const TYPES = ['', 'RESERVATION', 'HOLD'];
const STATUSES = ['', 'ACTIVE', 'EXPIRED', 'CONVERTED', 'RELEASED'];

export default function ReservationsPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['type', 'status', 'create', 'unitId']);
  const [, setParams] = useSearchParams();
  const createOpen = filters.create === '1';
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.type) q.set('type', filters.type);
  if (filters.status) q.set('status', filters.status);
  const { data, error, loading, retry } = useApi(`/reservations?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'unitId', kind: 'unit' },
    { key: 'dealId', kind: 'deal' },
  ]);

  function closeCreate() {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('create');
      next.delete('unitId');
      return next;
    }, { replace: true });
  }

  const columns = [
    { key: 'id', label: 'Reservation', render: (r) => <EntityLink to={`/app/reservations/${r.id}`}>{shortId(r.id)}</EntityLink> },
    { key: 'type', label: 'Type', render: (r) => <StatusBadge status={r.type} /> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'unitId', label: 'Unit', render: (r) => <RelatedName kind="unit" id={r.unitId} maps={maps} /> },
    { key: 'dealId', label: 'Deal', render: (r) => <RelatedName kind="deal" id={r.dealId} maps={maps} /> },
    { key: 'expiresAt', label: 'Expires', render: (r) => (r.expiresAt ? formatDateTime(r.expiresAt) : <span className="muted">No expiry</span>) },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Sales"
        title="Reservations & Holds"
        description="One row per claim, distinguished by type. Statuses are backend-driven — expiry runs on the server, never here."
        actions={<ReserveButtonInline onCreated={retry} />}
      />
      <FilterBar>
        <Select aria-label="Type" value={filters.type ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
          <option value="">All types</option>
          {TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>{prettifyEnum(t)}</option>
          ))}
        </Select>
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{prettifyEnum(s)}</option>
          ))}
        </Select>
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No reservations match these filters" message="Reserve a unit to open the first claim." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      {createOpen && (
        <ReserveDialog unitId={filters.unitId} onClose={closeCreate} onCreated={() => { closeCreate(); retry(); }} />
      )}
    </PageShell>
  );
}

function ReserveButtonInline({ onCreated }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="reservation" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Reserve / Hold</Button>
      {open && <ReserveDialog onClose={() => setOpen(false)} onCreated={onCreated} />}
    </PermissionGate>
  );
}
