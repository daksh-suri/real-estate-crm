import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Card } from '../../components/ui/controls';
import { Tabs } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import { useApi } from '../../hooks/useApi';

// Read-only Role → Permission → Data Scope matrix (Checkpoint 18, DEC-039).
// The mapping is backend configuration: this page presents it, never writes
// it. Backend authorization stays authoritative; gates here are UX-only.
function groupByResource(catalogue) {
  const groups = {};
  for (const p of catalogue || []) {
    if (!groups[p.resource]) groups[p.resource] = [];
    groups[p.resource].push(p.action);
  }
  return Object.keys(groups)
    .sort()
    .map((resource) => ({ resource, actions: groups[resource].sort() }));
}

export default function RolesPage() {
  const rolesQuery = useApi('/roles');
  const catalogueQuery = useApi('/roles/permissions/catalogue');
  const roles = rolesQuery.data ?? null;
  const catalogue = catalogueQuery.data ?? null;
  const loading = rolesQuery.loading || catalogueQuery.loading;
  const error = rolesQuery.error || catalogueQuery.error;
  const retry = () => { rolesQuery.retry(); catalogueQuery.retry(); };
  const [activeRole, setActiveRole] = useState(null);

  const groups = groupByResource(catalogue);
  const granted = {};
  for (const r of roles || []) {
    granted[r.id] = {};
    for (const p of r.permissions || []) {
      granted[r.id][`${p.resource}:${p.action}`] = p.scope;
    }
  }
  const selected = (roles || []).find((r) => r.id === (activeRole || roles?.[0]?.id)) || null;

  const columns = [
    { key: 'resource', label: 'Domain', render: (g) => g.resource },
    {
      key: 'actions',
      label: selected ? `Permissions — ${selected.name}` : 'Permissions',
      render: (g) => (
        <span className="row-actions">
          {g.actions.map((a) => {
            const scope = selected ? granted[selected.id]?.[`${g.resource}:${a}`] : null;
            return scope
              ? <StatusBadge key={a} status={`${a} · ${scope}`} />
              : <span key={a} className="muted">{a} —</span>;
          })}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Roles & permissions"
        description="The current authorization configuration. Role names and scopes are fixed for V1; the backend enforces every check."
      />
      <Card title="About this matrix">
        <p className="muted">
          Each role grants resource:action permissions at a data scope (OWN, TEAM, PROJECT, ORGANIZATION).
          Changes to this mapping are backend configuration in V1 — contact your administrator to adjust them.
        </p>
      </Card>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          {(roles || []).length === 0 ? (
            <EmptyState title="No roles" message="No roles exist in this organization yet." />
          ) : (
            <>
              <Tabs tabs={(roles || []).map((r) => ({ key: r.id, label: r.name }))} active={selected?.id} onChange={setActiveRole} />
              <Table columns={columns} rows={groups} rowKey={(g) => g.resource} empty={<EmptyState title="No permissions" message="The permission catalogue is empty." />} />
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
