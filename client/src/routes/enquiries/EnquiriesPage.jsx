import { Link } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Badge } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { Select } from '../../components/ui/controls';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';
import { LogEnquiryButton } from './IntakeDialog';

const CHANNELS = ['', 'PORTAL', 'WALK_IN', 'PHONE', 'OWNED_FORM'];
const LINKAGE = [
  { value: '', label: 'All linkage states' },
  { value: 'matched', label: 'Matched (has contact)' },
  { value: 'unmatched', label: 'Unmatched (no contact)' },
];

function queryFor({ limit, offset, filters }) {
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.channel) q.set('channel', filters.channel);
  if (filters.linkage === 'matched') q.set('unmatched', 'false');
  if (filters.linkage === 'unmatched') q.set('unmatched', 'true');
  return `/enquiries?${q.toString()}`;
}

export default function EnquiriesPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['channel', 'linkage']);
  const path = queryFor({ limit, offset, filters });
  const { data, error, loading, retry } = useApi(path);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'linkedLeadId', kind: 'lead' },
  ]);

  const columns = [
    {
      key: 'createdAt',
      label: 'Received',
      render: (r) => <EntityLink to={`/app/enquiries/${r.id}`}>{formatDateTime(r.createdAt)}</EntityLink>,
    },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'channel', label: 'Channel', render: (r) => <Badge tone="info">{r.channel}</Badge> },
    { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={maps} /> },
    {
      key: 'linkedLeadId',
      label: 'Lead',
      render: (r) =>
        r.linkedLeadId ? <RelatedName kind="lead" id={r.linkedLeadId} maps={maps} /> : <span className="muted">—</span>,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Work"
        title="Enquiries"
        description="Individual intake events. Repeat enquiries from the same contact attach to the open lead; identity-less intake is preserved for review."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/enquiries/unmatched">
              Review unmatched
            </Link>
            <LogEnquiryButton onCreated={retry} />
          </>
        }
      />
      <FilterBar>
        <Select aria-label="Channel" value={filters.channel ?? ''} onChange={(e) => setFilter('channel', e.target.value)}>
          <option value="">All channels</option>
          {CHANNELS.filter(Boolean).map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select aria-label="Linkage" value={filters.linkage ?? ''} onChange={(e) => setFilter('linkage', e.target.value)}>
          {LINKAGE.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title="No enquiries match these filters"
                message="Adjust the channel or linkage filters, or log the first enquiry."
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
