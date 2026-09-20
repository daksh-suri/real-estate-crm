import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Select } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { StatusBadge } from '../../components/crm/crm';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';
import { UploadDocumentButton } from './UploadDialog';

const STATUSES = ['', 'NOT_SUBMITTED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMITTED'];
export default function DocumentsPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['status']);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.status) q.set('status', filters.status);
  const { data, error, loading, retry } = useApi(`/documents?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'dealId', kind: 'deal' },
  ]);

  const columns = [
    { key: 'type', label: 'Type', render: (r) => <EntityLink to={`/app/documents/${r.id}`}>{r.type}</EntityLink> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'dealId', label: 'Deal', render: (r) => (r.dealId ? <RelatedName kind="deal" id={r.dealId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'version', label: 'Version', render: (r) => `v${r.version}` },
    { key: 'updatedAt', label: 'Updated', render: (r) => formatDateTime(r.updatedAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Documents"
        description="Versioned KYC/case files. File bytes live in private object storage; this system tracks metadata, status, and review."
        actions={<UploadDocumentButton onDone={retry} />}
      />
      <FilterBar>
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.filter(Boolean).map((s) => (
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
            empty={<EmptyState title="No documents match these filters" message="Upload the first document to begin the review lifecycle." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
