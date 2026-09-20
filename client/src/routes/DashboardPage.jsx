import { useState } from 'react';
import PageShell, { PageHeader } from '../components/layout/PageShell';
import { Card } from '../components/ui/controls';
import { EmptyState, ErrorState, Skeleton, Table } from '../components/ui/data';
import { EntityLink, FilterBar, StatTile, StatusBadge } from '../components/crm/crm';
import { Button } from '../components/ui/controls';
import './routes.css';

// Foundation demo page. ALL data below is clearly-labeled mock data proving
// the primitives compose — it is not backend state and must be replaced by
// the real Dashboard checkpoint. Also demonstrates loading/empty/error
// patterns via the "Preview states" toggle.
const MOCK_ROWS = [
  { id: 'demo-1', name: 'Aarav Sharma', stage: 'NEGOTIATION', status: 'OPEN', agent: 'Meera' },
  { id: 'demo-2', name: 'Diya Patel', stage: 'SITE_VISIT_SCHEDULED', status: 'SCHEDULED', agent: 'Arjun' },
  { id: 'demo-3', name: 'Kabir Rao', stage: 'PAYMENT_IN_PROGRESS', status: 'PENDING', agent: 'Meera' },
];

const COLUMNS = [
  { key: 'name', label: 'Deal (mock)' },
  { key: 'stage', label: 'Stage' },
  { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  {
    key: 'agent',
    label: 'Agent',
    render: (r) => <EntityLink to="/app/contacts">{r.agent}</EntityLink>,
  },
];

export default function DashboardPage() {
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState('data'); // data | loading | empty | error
  const [query, setQuery] = useState(search);

  const rows = MOCK_ROWS.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Foundation demo · mock data"
        title="Dashboard"
        description="Proves the shell, tokens, primitives, and state patterns compose. Replace with the real dashboard checkpoint."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPreview('data')}>
              Data
            </Button>
            <Button variant="secondary" onClick={() => setPreview('loading')}>
              Loading
            </Button>
            <Button variant="secondary" onClick={() => setPreview('empty')}>
              Empty
            </Button>
            <Button variant="secondary" onClick={() => setPreview('error')}>
              Error
            </Button>
          </>
        }
        stats={
          <>
            <StatTile label="Open deals (mock)" value="12" hint="+2 this week" />
            <StatTile label="Site visits (mock)" value="5" hint="3 scheduled today" />
            <StatTile label="Overdue tasks (mock)" value="3" hint="needs attention" />
            <StatTile label="Collections (mock)" value="₹48L" hint="due this month" />
          </>
        }
      />

      <FilterBar
        searchValue={search}
        onSearch={setSearch}
        searchPlaceholder="Search mock deals…"
        action={
          <Button variant="primary" onClick={() => setQuery(search)}>
            Apply
          </Button>
        }
      />

      <Card title="Pipeline snapshot (mock)">
        {preview === 'loading' && <Skeleton lines={4} />}
        {preview === 'empty' && (
          <EmptyState
            title="No deals match"
            message="Adjust the mock search, or wait for the real pipeline screen to show live data."
            action={
              <Button variant="secondary" onClick={() => { setSearch(''); setQuery(''); }}>
                Clear search
              </Button>
            }
          />
        )}
        {preview === 'error' && (
          <ErrorState message="Could not load the mock snapshot." onRetry={() => setPreview('data')} />
        )}
        {preview === 'data' && (
          <Table
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title="No deals match"
                message="Adjust the search to see the mock rows again."
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setQuery(''); }}>
                    Clear search
                  </Button>
                }
              />
            }
          />
        )}
      </Card>
    </PageShell>
  );
}
