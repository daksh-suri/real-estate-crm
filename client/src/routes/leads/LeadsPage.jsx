import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Select } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, prettifyEnum, shortId } from '../../lib/format';

const STATUSES = ['', 'OPEN', 'CONVERTED', 'DISQUALIFIED'];

export default function LeadsPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['status']);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.status) q.set('status', filters.status);
  const { data, error, loading, retry } = useApi(`/leads?${q.toString()}`);
  const rows = data ?? null;
  const ASSIGNMENT_LABEL = { AUTO: 'Automatic', MANUAL: 'Manual', UNASSIGNED: 'Unassigned' };
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'assignedAgentId', kind: 'user' },
  ]);

  const columns = [
    {
      key: 'id',
      label: 'Lead',
      render: (r) => <EntityLink to={`/app/leads/${r.id}`}>{shortId(r.id)}</EntityLink>,
    },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={maps} /> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'assignedAgentId',
      label: 'Assignee',
      render: (r) => (r.assignedAgentId ? <RelatedName kind="user" id={r.assignedAgentId} maps={maps} /> : <span className="muted">Unassigned</span>),
    },
    {
      key: 'assignmentSource',
      label: 'Source',
      render: (r) => ASSIGNMENT_LABEL[r.assignmentSource] || prettifyEnum(r.assignmentSource),
    },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Work"
        title="Leads"
        description="Working sales opportunities from intake. Leads open only through enquiry intake — there is no manual lead creation."
      />
      <FilterBar>
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
            empty={<EmptyState title="No leads match these filters" message="Leads appear here once intake creates them." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
