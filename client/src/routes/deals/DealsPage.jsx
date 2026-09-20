import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Select } from '../../components/ui/controls';
import { Tabs } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, prettifyEnum, shortId } from '../../lib/format';
import { DEAL_STAGES } from '../../lib/dealWorkflow';
import { CreateDealButton } from './CreateDealDialog';

const TABS = [
  { key: 'list', label: 'List' },
  { key: 'pipeline', label: 'Pipeline' },
];

function DealColumns({ maps }) {
  return [
    { key: 'id', label: 'Deal', render: (r) => <EntityLink to={`/app/deals/${r.id}`}>{shortId(r.id)}</EntityLink> },
    { key: 'stage', label: 'Stage', render: (r) => <StatusBadge status={r.stage} /> },
    { key: 'contactId', label: 'Contact', render: (r) => <RelatedName kind="contact" id={r.contactId} maps={maps} /> },
    { key: 'leadId', label: 'Lead', render: (r) => <RelatedName kind="lead" id={r.leadId} maps={maps} /> },
    { key: 'unitId', label: 'Unit', render: (r) => (r.unitId ? <span title={r.unitId}>{shortId(r.unitId)}</span> : <span className="muted">—</span>) },
    { key: 'lostReason', label: 'Lost reason', render: (r) => r.lostReason || <span className="muted">—</span> },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
  ];
}

function Pipeline({ rows }) {
  const byStage = new Map(DEAL_STAGES.map((s) => [s, []]));
  for (const r of rows || []) {
    if (byStage.has(r.stage)) byStage.get(r.stage).push(r);
    else byStage.get('NEW').push(r);
  }
  return (
    <div className="pipeline" role="list" aria-label="Deal pipeline by stage">
      {DEAL_STAGES.map((stage) => {
        const cards = byStage.get(stage);
        return (
          <section key={stage} className="pipeline__column" aria-label={prettifyEnum(stage)}>
            <header className="pipeline__header">
              <span className="pipeline__title">{prettifyEnum(stage)}</span>
              <span className="pipeline__count">{cards.length}</span>
            </header>
            {cards.length === 0 && <p className="pipeline__empty">No deals</p>}
            {cards.map((d) => (
              <EntityLink key={d.id} to={`/app/deals/${d.id}`}>
                <article className="pipeline__card" role="listitem">
                  <span className="pipeline__card-title">{shortId(d.id)}</span>
                  <span className="pipeline__card-meta">{formatDateTime(d.createdAt)}</span>
                </article>
              </EntityLink>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export default function DealsPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['stage', 'view']);
  const [view, setView] = useState(filters.view === 'pipeline' ? 'pipeline' : 'list');
  const q = new URLSearchParams({ limit: String(view === 'pipeline' ? 100 : limit), offset: String(view === 'pipeline' ? 0 : offset) });
  if (filters.stage) q.set('stage', filters.stage);
  const { data, error, loading, retry } = useApi(`/deals?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'contactId', kind: 'contact' },
    { key: 'leadId', kind: 'lead' },
  ]);

  function onTab(key) {
    setView(key);
    setFilter('view', key === 'pipeline' ? 'pipeline' : '');
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Sales"
        title="Deals"
        description="Pipeline records converted from open leads. Stages move only through valid transitions on the deal."
        actions={<CreateDealButton onCreated={retry} />}
      />
      <Tabs tabs={TABS} active={view} onChange={onTab} />
      <FilterBar>
        <Select aria-label="Stage" value={filters.stage ?? ''} onChange={(e) => setFilter('stage', e.target.value)}>
          <option value="">All stages</option>
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>{prettifyEnum(s)}</option>
          ))}
        </Select>
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && view === 'list' && (
        <>
          <Table
            columns={DealColumns({ maps })}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No deals match these filters" message="Deals appear here once created from open leads." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}
      {!loading && !error && view === 'pipeline' && (
        <>
          {(rows || []).length === 0 && (
            <EmptyState title="Pipeline is empty" message="Create the first deal to populate the stages." />
          )}
          <Pipeline rows={rows} />
          {(rows || []).length === 100 && (
            <p className="muted">Showing the first 100 deals — narrow the stage filter to see more.</p>
          )}
        </>
      )}
    </PageShell>
  );
}
