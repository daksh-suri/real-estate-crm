import PageShell, { PageHeader } from '../../components/layout/PageShell';import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, shortId } from '../../lib/format';
import { CreatePlanButton } from './CreatePlanDialog';

export default function PaymentsPage() {
  const { search, limit, offset, filters, setSearch, setPage } = useUrlListState(['dealId', 'planFor']);
  const planFor = filters.planFor || null;
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.dealId) q.set('dealId', filters.dealId);
  const { data, error, loading, retry } = useApi(`/payment-plans?${q.toString()}`);
  const rows = data ?? null;
  const visible = search
    ? (rows || []).filter((r) => [r.id, r.dealId].some((v) => String(v || '').toLowerCase().includes(search.toLowerCase())))
    : rows;
  const maps = useRelatedNames(visible, [{ key: 'dealId', kind: 'deal' }]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Sales"
        title="Payments"
        description="Deal-specific payment plans. Overdue is derived at read — never stored. Records arrive via the gateway webhook, never by hand."
        actions={<CreatePlanButton bookingId={planFor} onCreated={retry} />}
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Filter this page by ID…" />
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={[
              { key: 'id', label: 'Plan', render: (r) => <EntityLink to={`/app/payments/${r.id}`}>{shortId(r.id)}</EntityLink> },
              { key: 'dealId', label: 'Deal', render: (r) => <RelatedName kind="deal" id={r.dealId} maps={maps} /> },
              { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
            ]}
            rows={visible}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No payment plans yet" message="Create a plan from a booking to start the schedule." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
