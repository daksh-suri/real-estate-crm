import { Link } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Badge } from '../../components/ui/controls';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink } from '../../components/crm/crm';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime } from '../../lib/format';

// Review queue for intake that arrived without usable identity (no
// phone/email after normalization). Read-only: the backend exposes no
// resolution operation today, so there are no resolve buttons — only review.
export default function UnmatchedEnquiriesPage() {
  const { limit, offset, setPage } = useUrlListState([]);
  const { data, error, loading, retry } = useApi(`/enquiries?unmatched=true&limit=${limit}&offset=${offset}`);
  const rows = data ?? null;

  const columns = [
    {
      key: 'createdAt',
      label: 'Received',
      render: (r) => <EntityLink to={`/app/enquiries/${r.id}`}>{formatDateTime(r.createdAt)}</EntityLink>,
    },
    { key: 'channel', label: 'Channel', render: (r) => <Badge tone="warning">{r.channel}</Badge> },
    {
      key: 'signals',
      label: 'Available signals',
      render: (r) => {
        const keys = r.rawPayload && typeof r.rawPayload === 'object' ? Object.keys(r.rawPayload) : [];
        return keys.length > 0 ? keys.join(', ') : <span className="muted">none</span>;
      },
    },
    {
      key: 'why',
      label: 'Why unmatched',
      render: () => <span className="muted">No usable phone or email at intake — no contact could be resolved.</span>,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Enquiries"
        title="Unmatched enquiries"
        description="Intake events preserved without a contact. They are evidence, not errors — resolve them once the customer is identified through a future workflow."
        actions={
          <Link className="btn btn--secondary btn--md" to="/app/enquiries">
            ← All enquiries
          </Link>
        }
      />
      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No unmatched enquiries" message="Every recent intake event resolved to a contact." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
