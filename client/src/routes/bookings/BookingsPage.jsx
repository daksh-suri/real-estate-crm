import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, shortId } from '../../lib/format';
import { BookingDialog } from './BookingDialog';

function isCancelled(b) {
  return !!b.cancelledAt;
}

export default function BookingsPage() {
  const { search, limit, offset, filters, setSearch, setFilter, setPage } = useUrlListState(['convert']);
  const convertId = filters.convert || null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const { data, error, loading, retry } = useApi(`/bookings?${q.toString()}`);
  const rows = (data ?? null);
  // Client-side search over the page (no backend search param exists):
  // honest substring match on identifiers within the fetched page only.
  const visible = search
    ? (rows || []).filter((r) => [r.id, r.unitId, r.dealId, r.reservationId].some((v) => String(v || '').toLowerCase().includes(search.toLowerCase())))
    : rows;
  const maps = useRelatedNames(visible, [
    { key: 'unitId', kind: 'unit' },
    { key: 'dealId', kind: 'deal' },
    { key: 'reservationId', kind: 'reservation' },
  ]);

  const columns = [
    { key: 'id', label: 'Booking', render: (r) => <EntityLink to={`/app/bookings/${r.id}`}>{shortId(r.id)}</EntityLink> },
    {
      key: 'state',
      label: 'State',
      render: (r) => (isCancelled(r) ? <StatusBadge status="CANCELLED" /> : <StatusBadge status="BOOKED" />),
    },
    { key: 'unitId', label: 'Unit', render: (r) => <RelatedName kind="unit" id={r.unitId} maps={maps} /> },
    { key: 'dealId', label: 'Deal', render: (r) => <RelatedName kind="deal" id={r.dealId} maps={maps} /> },
    { key: 'reservationId', label: 'Reservation', render: (r) => <RelatedName kind="reservation" id={r.reservationId} maps={maps} /> },
    { key: 'bookedAt', label: 'Booked', render: (r) => formatDateTime(r.bookedAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Sales"
        title="Bookings"
        description="Recorded sales. A booking has no status enum — cancelled means the cancel triple is stamped, otherwise it stands."
        actions={
          <>
            <Button variant="primary" onClick={() => setDialogOpen(true)}>Convert reservation</Button>
          </>
        }
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Filter this page by ID…" />
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No bookings yet" message="Convert an ACTIVE reservation to record the first sale." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      {(dialogOpen || convertId) && (
        <BookingDialog
          reservationId={convertId}
          onClose={() => { setDialogOpen(false); setFilter('convert', ''); }}
          onCreated={retry}
        />
      )}
    </PageShell>
  );
}
