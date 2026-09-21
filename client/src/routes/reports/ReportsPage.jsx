import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/data';
import { FilterBar } from '../../components/crm/crm';
import { StatTile } from '../../components/crm/crm';
import { Card } from '../../components/ui/controls';
import { Tabs } from '../../components/ui/overlays';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { prettifyEnum } from '../../lib/format';

// Reports & Analytics (Checkpoint 17G). Read-only views over existing
// records — snapshot distributions plus creations in a half-open [from, to)
// window (dates are UTC midnights; the end day is inclusive). No velocity or
// duration metrics: the database keeps no transition history for them.

// YYYY-MM-DD → start-of-day UTC ISO, or '' when unset.
export function toRangeStart(dateStr) {
  if (!dateStr) return '';
  return `${dateStr}T00:00:00.000Z`;
}

// YYYY-MM-DD → start of the NEXT day UTC ISO (end day stays inclusive).
export function toRangeEnd(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export function rangeQuery(from, to) {
  const q = new URLSearchParams();
  const start = toRangeStart(from);
  const end = toRangeEnd(to);
  if (start) q.set('from', start);
  if (end) q.set('to', end);
  const s = q.toString();
  return s ? `?${s}` : '';
}

const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'operations', label: 'Operations' },
  { key: 'money', label: 'Money & Docs' },
];

// Distribution bars (CSS only — no chart dependency). Colocated: used twice
// on this page, nowhere else.
function DistBars({ items, labelKey }) {
  const rows = items ?? [];
  if (rows.length === 0) return <p className="muted">No data in this range.</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div>
      {rows.map((r) => (
        <div key={String(r[labelKey])} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <span style={{ minWidth: '10rem' }}>{prettifyEnum(String(r[labelKey]))}</span>
          <div style={{ flex: 1, background: 'var(--bg-muted)', borderRadius: '4px' }}>
            <div style={{ width: `${max ? Math.round((r.count / max) * 100) : 0}%`, background: 'var(--accent-primary)', borderRadius: '4px', minHeight: '1rem' }} />
          </div>
          <span className="muted">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, loading, error, retry, empty, children }) {
  return (
    <Card title={title}>
      {loading && <Skeleton lines={4} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (empty ? <EmptyState title="No data" message="Nothing recorded for this range." /> : children)}
    </Card>
  );
}

function Tiles({ tiles }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
      {tiles.map((t) => (
        <StatTile key={t.label} label={t.label} value={String(t.value)} hint={t.hint} />
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { filters, setFilter } = useUrlListState(['view', 'from', 'to']);
  const view = filters.view || 'pipeline';
  const [tab, setTab] = useState(TABS.some((t) => t.key === view) ? view : 'pipeline');
  const query = rangeQuery(filters.from ?? '', filters.to ?? '');
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  function onTab(key) {
    setTab(key);
    setFilter('view', key === 'pipeline' ? '' : key);
  }

  const deals = useApi(`/reports/deals${query}`, { enabled: tab === 'pipeline' && !rangeInvalid });
  const leads = useApi(`/reports/leads${query}`, { enabled: tab === 'pipeline' && !rangeInvalid });
  const visits = useApi(`/reports/visits${query}`, { enabled: tab === 'operations' && !rangeInvalid });
  const bookings = useApi(`/reports/bookings${query}`, { enabled: tab === 'operations' && !rangeInvalid });
  const tasks = useApi(`/reports/tasks${query}`, { enabled: tab === 'operations' && !rangeInvalid });
  const activities = useApi(`/reports/activities${query}`, { enabled: tab === 'operations' && !rangeInvalid });
  const payments = useApi(`/reports/payments${query}`, { enabled: tab === 'money' && !rangeInvalid });
  const inventory = useApi('/reports/inventory', { enabled: tab === 'money' });
  const documents = useApi(`/reports/documents${query}`, { enabled: tab === 'money' && !rangeInvalid });
  const contacts = useApi(`/reports/contacts${query}`, { enabled: tab === 'money' && !rangeInvalid });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        description="Snapshots and creations over time, read straight from CRM records. Dates are UTC; the end day is inclusive."
      />
      <Tabs tabs={TABS} active={tab} onChange={onTab} />
      <FilterBar>
        <label>
          From{' '}
          <input type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label>
          To{' '}
          <input type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
      </FilterBar>
      {rangeInvalid && <ErrorState message="Invalid date range: the start day must not be after the end day." />}

      {!rangeInvalid && tab === 'pipeline' && (
        <>
          <Section title="Deals" loading={deals.loading} error={deals.error} retry={deals.retry}>
            {deals.data && (
              <>
                <Tiles tiles={[{ label: 'Deals created', value: deals.data.created }]} />
                <DistBars items={deals.data.byStage} labelKey="stage" />
              </>
            )}
          </Section>
          <Section title="Leads" loading={leads.loading} error={leads.error} retry={leads.retry}>
            {leads.data && (
              <>
                <Tiles tiles={[{ label: 'Leads created', value: leads.data.created }]} />
                <DistBars items={leads.data.byStatus} labelKey="status" />
                <h4>Intake by channel</h4>
                <DistBars items={leads.data.intakeByChannel} labelKey="channel" />
              </>
            )}
          </Section>
        </>
      )}

      {!rangeInvalid && tab === 'operations' && (
        <>
          <Section title="Site visits" loading={visits.loading} error={visits.error} retry={visits.retry}>
            {visits.data && (
              <>
                <Tiles tiles={[{ label: 'Scheduled', value: visits.data.scheduled }, { label: 'Cancelled', value: visits.data.cancelled }]} />
                <DistBars items={visits.data.byStatus} labelKey="status" />
              </>
            )}
          </Section>
          <Section title="Bookings & holds" loading={bookings.loading} error={bookings.error} retry={bookings.retry}>
            {bookings.data && (
              <>
                <Tiles tiles={[{ label: 'Booked', value: bookings.data.booked }, { label: 'Cancelled', value: bookings.data.cancelled }]} />
                <DistBars items={bookings.data.reservationsByStatus} labelKey="status" />
              </>
            )}
          </Section>
          <Section title="Tasks" loading={tasks.loading} error={tasks.error} retry={tasks.retry}>
            {tasks.data && (
              <>
                <Tiles tiles={[{ label: 'Created', value: tasks.data.created }, { label: 'Overdue now', value: tasks.data.overdueNow }]} />
                <DistBars items={tasks.data.byStatus} labelKey="status" />
              </>
            )}
          </Section>
          <Section title="Activities" loading={activities.loading} error={activities.error} retry={activities.retry}>
            {activities.data && (
              <>
                <Tiles tiles={[{ label: 'Logged', value: activities.data.total }]} />
                <DistBars items={activities.data.byType} labelKey="type" />
              </>
            )}
          </Section>
        </>
      )}

      {!rangeInvalid && tab === 'money' && (
        <>
          <Section title="Payments" loading={payments.loading} error={payments.error} retry={payments.retry}>
            {payments.data && (
              <>
                <Tiles tiles={[{ label: 'Overdue now', value: payments.data.overdueNow }, { label: 'Collected', value: String(payments.data.collected ?? 0) }]} />
                <DistBars items={payments.data.obligationsByStatus} labelKey="status" />
              </>
            )}
          </Section>
          <Section title="Inventory (snapshot)" loading={inventory.loading} error={inventory.error} retry={inventory.retry} empty={!inventory.data || inventory.data.unitsByAvailability.length === 0}>
            {inventory.data && <DistBars items={inventory.data.unitsByAvailability} labelKey="availabilityStatus" />}
          </Section>
          <Section title="Documents" loading={documents.loading} error={documents.error} retry={documents.retry}>
            {documents.data && (
              <>
                <Tiles tiles={[{ label: 'Reviewed', value: documents.data.reviewed }]} />
                <DistBars items={documents.data.byStatus} labelKey="status" />
              </>
            )}
          </Section>
          <Section title="Contacts" loading={contacts.loading} error={contacts.error} retry={contacts.retry}>
            {contacts.data && (
              <>
                <Tiles tiles={[{ label: 'Created', value: contacts.data.created }, { label: 'Duplicates pending', value: contacts.data.duplicatesPending }]} />
                <DistBars items={contacts.data.byConsent} labelKey="communicationConsent" />
              </>
            )}
          </Section>
        </>
      )}
    </PageShell>
  );
}
