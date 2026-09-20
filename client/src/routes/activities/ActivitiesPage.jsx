import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, shortId } from '../../lib/format';
import { LogActivityButton } from './LogActivityDialog';

// Immutable history: what happened. No edit/delete UI exists by design —
// the backend provides no such endpoints.
export default function ActivitiesPage() {
  const { limit, offset, setPage } = useUrlListState([]);
  const { data, error, loading, retry } = useApi(`/activities?limit=${limit}&offset=${offset}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'leadId', kind: 'lead' },
    { key: 'dealId', kind: 'deal' },
  ]);

  const columns = [
    { key: 'type', label: 'Type', render: (r) => <span>{r.type}</span> },
    { key: 'outcome', label: 'Outcome', render: (r) => r.outcome || <span className="muted">—</span> },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'leadId', label: 'Lead', render: (r) => (r.leadId ? <RelatedName kind="lead" id={r.leadId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'dealId', label: 'Deal', render: (r) => (r.dealId ? <RelatedName kind="deal" id={r.dealId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'notes', label: 'Notes', render: (r) => (r.notes ? <span title={r.notes}>{r.notes.slice(0, 80)}{r.notes.length > 80 ? '…' : ''}</span> : <span className="muted">—</span>) },
    { key: 'createdBy', label: 'Logged by', render: (r) => <span title={r.createdBy}>{shortId(r.createdBy)}</span> },
    { key: 'createdAt', label: 'Logged at', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Activities"
        description="Immutable log of what happened. Logging an interaction never completes a task — follow-ups are explicit."
        actions={<LogActivityButton onLogged={retry} />}
      />

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
                title="No activities yet"
                message="Log the first interaction. Activities cannot be edited or deleted — they are history."
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
          {!loading && (rows || []).length > 0 && (
            <p className="muted">
              Tip: open a <EntityLink to="/app/contacts">contact</EntityLink> to see its own activity trail.
            </p>
          )}
        </>
      )}
    </PageShell>
  );
}
