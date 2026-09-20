import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Input, Select } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDate, formatDateTime, prettifyEnum, shortId } from '../../lib/format';
import { VISIT_STATUSES } from '../../lib/visitWorkflow';
import { ScheduleVisitButton } from './ScheduleDialog';

function DayGroups({ rows, maps }) {
  const groups = new Map();
  for (const r of rows || []) {
    const day = formatDate(r.scheduledAt);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(r);
  }
  return (
    <>
      {[...groups.entries()].map(([day, visits]) => (
        <section key={day} className="day-group" aria-label={day}>
          <h2 className="day-group__title">{day} · {visits.length}</h2>
          <Table
            columns={visitColumns(maps)}
            rows={visits}
            rowKey={(r) => r.id}
          />
        </section>
      ))}
    </>
  );
}

function visitColumns(maps) {
  return [
    { key: 'scheduledAt', label: 'Slot', render: (r) => <EntityLink to={`/app/site-visits/${r.id}`}>{formatDateTime(r.scheduledAt)} · {r.durationMinutes}m</EntityLink> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={maps} /> },
    { key: 'agentId', label: 'Agent', render: (r) => <span title={r.agentId}>{shortId(r.agentId)}</span> },
  ];
}

export default function VisitsPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['status', 'from', 'to']);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.status) q.set('status', filters.status);
  if (filters.from) q.set('from', filters.from);
  if (filters.to) q.set('to', filters.to);
  const { data, error, loading, retry } = useApi(`/site-visits?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Sales"
        title="Site visits"
        description="Scheduled property visits, earliest first. Slots are backend-authoritative — conflicts surface from the server."
        actions={<ScheduleVisitButton onScheduled={retry} />}
      />
      <FilterBar>
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {VISIT_STATUSES.map((s) => (
            <option key={s} value={s}>{prettifyEnum(s)}</option>
          ))}
        </Select>
        {/* UTC-midnight construction (Z suffix): matches the Reports UTC range
            convention — bare date strings parse as local time and shift the
            filter window by the viewer's timezone offset. */}
        <Input type="date" aria-label="From date" value={filters.from ? filters.from.slice(0, 10) : ''} onChange={(e) => setFilter('from', e.target.value ? new Date(`${e.target.value}T00:00:00Z`).toISOString() : '')} />
        <Input type="date" aria-label="To date" value={filters.to ? filters.to.slice(0, 10) : ''} onChange={(e) => setFilter('to', e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : '')} />
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (rows || []).length === 0 && (
        <EmptyState title="No visits match these filters" message="Schedule the first visit, or widen the date range." />
      )}
      {!loading && !error && (rows || []).length > 0 && (
        <>
          <DayGroups rows={rows} maps={maps} />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
