import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Select } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, formatMoney } from '../../lib/format';

const AVAILABILITY = ['', 'AVAILABLE', 'ON_HOLD', 'RESERVED', 'BOOKED', 'BLOCKED'];

export default function InventoryPage() {
  const { search, limit, offset, filters, setSearch, setFilter, setPage } = useUrlListState(['availabilityStatus']);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) q.set('search', search);
  if (filters.availabilityStatus) q.set('availabilityStatus', filters.availabilityStatus);
  const { data, error, loading, retry } = useApi(`/units?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [{ key: 'projectId', kind: 'project' }]);

  const columns = [
    { key: 'identifier', label: 'Unit', render: (r) => <EntityLink to={`/app/properties/inventory/${r.id}`}>{r.identifier}</EntityLink> },
    { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={maps} /> },
    { key: 'availabilityStatus', label: 'Availability', render: (r) => <StatusBadge status={r.availabilityStatus} /> },
    { key: 'totalCost', label: 'Total cost', render: (r) => formatMoney(r.totalCost) },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Property"
        title="Inventory"
        description="Every unit across projects. Availability is backend-authoritative — it changes through reservation workflows, never by editing here."
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search units…" />
        <Select aria-label="Availability" value={filters.availabilityStatus ?? ''} onChange={(e) => setFilter('availabilityStatus', e.target.value)}>
          <option value="">All availability</option>
          {AVAILABILITY.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
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
            empty={<EmptyState title="No units match these filters" message="Units appear here once added to a project." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
