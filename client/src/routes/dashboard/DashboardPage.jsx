import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { StatTile, EntityLink } from '../../components/crm/crm';
import { StatusBadge } from '../../components/crm/crm';
import { Card } from '../../components/ui/controls';
import { useApi } from '../../hooks/useApi';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { prettifyEnum } from '../../lib/format';
import './dashboard.css';

// Dashboard (Checkpoint 17H). Operational overview — one fetch, no tabs/filters.
// DistBars copied locally from ReportsPage (2 usages ≠ abstraction).

function DistBars({ items, labelKey }) {
  const rows = items ?? [];
  if (rows.length === 0) return <p className="muted">No data.</p>;
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
      {!loading && !error && (empty ? <EmptyState title="No data" message={empty} /> : children)}
    </Card>
  );
}

function AttentionTile({ label, count, to, emptyMessage }) {
  return (
    <div className="attention-tile">
      <p className="attention-tile__label">{label}</p>
      <p className="attention-tile__value">{count}</p>
      {count > 0 ? (
        <EntityLink to={to} className="attention-tile__link">View all</EntityLink>
      ) : (
        <p className="muted">{emptyMessage}</p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data, error, loading, retry } = useApi('/dashboard');

  const visitMaps = useRelatedNames(data?.upcomingVisitsList ?? [], [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
  ]);
  const activityMaps = useRelatedNames(data?.recentActivities ?? [], [
    { key: 'contactId', kind: 'contact' },
  ]);

  // Columns defined inside component so render functions close over maps
  const visitColumns = [
    { key: 'scheduledAt', label: 'When', render: (r) => new Date(r.scheduledAt).toLocaleString() },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={visitMaps} /> },
    { key: 'projectId', label: 'Project', render: (r) => <RelatedName kind="project" id={r.projectId} maps={visitMaps} /> },
  ];

  const activityColumns = [
    { key: 'type', label: 'Type' },
    { key: 'outcome', label: 'Outcome', render: (r) => r.outcome || '—' },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={activityMaps} /> },
    { key: 'createdAt', label: 'When', render: (r) => new Date(r.createdAt).toLocaleString() },
  ];

  return (
    <PageShell>
      <PageHeader eyebrow="Work" title="Dashboard" />

      {loading && <Skeleton lines={8} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}

      {!loading && !error && data && (
        <>
          <div className="kpi-strip">
            <StatTile label="Open Leads" value={String(data.openLeads)} />
            <StatTile label="Active Deals" value={String(data.activeDeals)} />
            <StatTile label="Upcoming Visits" value={String(data.upcomingVisits)} />
            <StatTile label="Active Reservations" value={String(data.activeReservations)} />
            <StatTile label="Open Tasks" value={String(data.openTasks)} />
            <StatTile label="Overdue Tasks" value={String(data.overdueTasks)} hint={data.overdueTasks > 0 ? 'Needs attention' : undefined} />
          </div>

          <Section title="Needs Attention" loading={false} error={null}>
            <div className="attention-grid">
              <AttentionTile label="Overdue Tasks" count={data.overdueTasks} to="/app/tasks" emptyMessage="All on track" />
              <AttentionTile label="Overdue Payments" count={data.overduePayments} to="/app/payments" emptyMessage="No overdue payments" />
              <AttentionTile label="Expiring Reservations" count={data.expiringReservations} to="/app/reservations" emptyMessage="No imminent expirations" />
            </div>
          </Section>

          <div className="dashboard-two-col">
            <Section
              title="Pipeline"
              loading={false}
              error={null}
              empty={data.dealsByStage.length === 0 ? 'No active deals.' : null}
            >
              <DistBars items={data.dealsByStage} labelKey="stage" />
            </Section>

            <Section
              title="Inventory"
              loading={false}
              error={null}
              empty={data.unitsByAvailability.length === 0 ? 'No units.' : null}
            >
              <DistBars items={data.unitsByAvailability} labelKey="availabilityStatus" />
            </Section>
          </div>

          <div className="dashboard-two-col">
            <Section
              title="Upcoming Site Visits"
              loading={false}
              error={null}
              empty={(data.upcomingVisitsList ?? []).length === 0 ? 'No upcoming visits.' : null}
            >
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <EntityLink to="/app/site-visits">
                  <span className="muted" style={{ fontSize: '0.85rem' }}>View all site visits →</span>
                </EntityLink>
                <EntityLink to="/app/calendar">
                  <span className="muted" style={{ fontSize: '0.85rem' }}>View calendar →</span>
                </EntityLink>
              </div>
              <Table
                columns={visitColumns}
                rows={data.upcomingVisitsList}
                rowKey={(r) => r.id}
                empty={null}
              />
            </Section>

            <Section
              title="Recent Activity"
              loading={false}
              error={null}
              empty={(data.recentActivities ?? []).length === 0 ? 'No activity logged yet.' : null}
            >
              <EntityLink to="/app/activities">
                <span className="muted" style={{ fontSize: '0.85rem' }}>View all activities →</span>
              </EntityLink>
              <Table
                columns={activityColumns}
                rows={data.recentActivities}
                rowKey={(r) => r.id}
                empty={null}
              />
            </Section>
          </div>
        </>
      )}
    </PageShell>
  );
}
