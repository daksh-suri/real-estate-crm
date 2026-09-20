import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, SearchInput } from '../../components/crm/crm';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, prettifyEnum } from '../../lib/format';

export default function ContactsPage() {
  const { search, limit, offset, setSearch, setPage } = useUrlListState([]);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) q.set('search', search);
  const { data, error, loading, retry } = useApi(`/contacts?${q.toString()}`);
  const rows = data ?? null;

  const columns = [
    { key: 'name', label: 'Name', render: (r) => <EntityLink to={`/app/contacts/${r.id}`}>{r.name}</EntityLink> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
    { key: 'email', label: 'Email', render: (r) => r.email || <span className="muted">—</span> },
    { key: 'communicationConsent', label: 'Consent', render: (r) => prettifyEnum(r.communicationConsent) },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Work"
        title="Contacts"
        description="Durable customer identities. Requirements, enquiries, and leads attach to contacts — never the reverse."
      />
      <FilterBar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, or email…" />
      </FilterBar>

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
                title={search ? 'No contacts match this search' : 'No contacts yet'}
                message={search ? 'Try a different name, phone, or email.' : 'Contacts appear here once intake resolves them.'}
              />
            }
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
    </PageShell>
  );
}
