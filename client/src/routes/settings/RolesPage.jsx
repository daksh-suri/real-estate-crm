import { useEffect, useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, Tabs } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';

const SCOPES = ['OWN', 'TEAM', 'PROJECT', 'ORGANIZATION'];

function groupByResource(catalogue) {
  const groups = {};
  for (const p of catalogue || []) {
    if (!groups[p.resource]) groups[p.resource] = [];
    groups[p.resource].push(p);
  }
  return Object.keys(groups)
    .sort()
    .map((resource) => ({ resource, perms: groups[resource].sort((a, b) => a.action.localeCompare(b.action)) }));
}

function CreateRoleDialog({ open, onClose, catalogue, onCreated }) {
  const { api } = useAuth();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState({}); // permissionId -> scope
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName('');
      setSelected({});
      setError(null);
    }
  }, [open]);

  const groups = groupByResource(catalogue);

  function toggle(permId, checked) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[permId] = 'ORGANIZATION';
      else delete next[permId];
      return next;
    });
    setError(null);
  }

  function setScope(permId, scope) {
    setSelected((prev) => ({ ...prev, [permId]: scope }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError({ message: 'Role name must be at least 2 characters' });
      return;
    }
    setPending(true);
    setError(null);
    try {
      const permissions = Object.entries(selected).map(([permissionId, scope]) => ({ permissionId, scope }));
      await api('/roles', { method: 'POST', body: { name: trimmed, permissions } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      title="Create role"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Creating…' : 'Create role'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Role name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} placeholder="Sales Agent" />
        </Field>
        <div>
          <p className="form-field__label">Permissions</p>
          <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>Select permissions and scope. Only Admin can create roles.</p>
          <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '0.5rem' }}>
            {groups.map((g) => (
              <div key={g.resource} style={{ marginBottom: '0.75rem' }}>
                <strong style={{ textTransform: 'capitalize' }}>{g.resource}</strong>
                {g.perms.map((p) => {
                  const checked = selected[p.id] !== undefined;
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <input type="checkbox" checked={checked} onChange={(e) => toggle(p.id, e.target.checked)} id={`perm-${p.id}`} />
                      <label htmlFor={`perm-${p.id}`} style={{ flex: 1, fontSize: '0.9rem' }}>{p.action}</label>
                      {checked && (
                        <Select value={selected[p.id]} onChange={(e) => setScope(p.id, e.target.value)} style={{ width: '140px' }}>
                          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function ManagePermissionsDialog({ open, onClose, role, catalogue, onSaved }) {
  const { api } = useAuth();
  const [selected, setSelected] = useState({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && role) {
      const map = {};
      for (const p of role.permissions || []) {
        // role.permissions now has permissionId, but catalogue lookup via id
        map[p.permissionId] = p.scope;
      }
      setSelected(map);
      setError(null);
    }
  }, [open, role]);

  const groups = groupByResource(catalogue);

  function toggle(permId, checked) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[permId] = 'ORGANIZATION';
      else delete next[permId];
      return next;
    });
    setError(null);
  }

  function setScope(permId, scope) {
    setSelected((prev) => ({ ...prev, [permId]: scope }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (pending || !role) return;
    setPending(true);
    setError(null);
    try {
      const permissions = Object.entries(selected).map(([permissionId, scope]) => ({ permissionId, scope }));
      await api(`/roles/${role.id}/permissions`, { method: 'PUT', body: { permissions } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  if (!role) return null;

  return (
    <Dialog
      open={open}
      title={`Manage permissions — ${role.name}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <div style={{ maxHeight: '360px', overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '0.5rem' }}>
          {groups.map((g) => (
            <div key={g.resource} style={{ marginBottom: '0.75rem' }}>
              <strong style={{ textTransform: 'capitalize' }}>{g.resource}</strong>
              {g.perms.map((p) => {
                const checked = selected[p.id] !== undefined;
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                    <input type="checkbox" checked={checked} onChange={(e) => toggle(p.id, e.target.checked)} id={`edit-${p.id}`} />
                    <label htmlFor={`edit-${p.id}`} style={{ flex: 1, fontSize: '0.9rem' }}>{p.action}</label>
                    {checked && (
                      <Select value={selected[p.id]} onChange={(e) => setScope(p.id, e.target.value)} style={{ width: '140px' }}>
                        {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function RolesPage() {
  const { push } = useToast();
  const rolesQuery = useApi('/roles');
  const catalogueQuery = useApi('/roles/permissions/catalogue');
  const roles = rolesQuery.data ?? null;
  const catalogue = catalogueQuery.data ?? null;
  const loading = rolesQuery.loading || catalogueQuery.loading;
  const error = rolesQuery.error || catalogueQuery.error;
  const retry = () => { rolesQuery.retry(); catalogueQuery.retry(); };
  const [activeRole, setActiveRole] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState(null);

  const groups = groupByResource(catalogue);
  const granted = {};
  for (const r of roles || []) {
    granted[r.id] = {};
    for (const p of r.permissions || []) {
      // Use permissionId for edit mapping, but display via resource:action
      granted[r.id][`${p.resource}:${p.action}`] = p.scope;
      granted[r.id][`id:${p.permissionId}`] = p.scope;
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
          {g.perms.map((p) => {
            const scope = selected ? granted[selected.id]?.[`${p.resource}:${p.action}`] : null;
            // Also support lookup via permissionId for new catalogue shape
            const scopeById = selected ? granted[selected.id]?.[`id:${p.id}`] : null;
            const s = scope || scopeById;
            return s
              ? <StatusBadge key={p.id} status={`${p.action} · ${s}`} />
              : <span key={p.id} className="muted">{p.action} —</span>;
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
        description="Manage roles and their access levels. Roles are organization-scoped; permissions come from the global catalogue."
        actions={
          <PermissionGate resource="role" action="create">
            <Button variant="primary" onClick={() => setCreateOpen(true)}>Create role</Button>
          </PermissionGate>
        }
      />
      <Card title="About this matrix">
        <p className="muted">
          Each role grants resource:action permissions at a data scope (OWN, TEAM, PROJECT, ORGANIZATION).
          Create custom roles (e.g. Sales Agent) and assign the exact permissions each needs. Creating a role is atomic — if any permission is invalid, no role is left behind. Admin retains its permissions unless explicitly changed.
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Tabs tabs={(roles || []).map((r) => ({ key: r.id, label: `${r.name} (${(r.permissions||[]).length})` }))} active={selected?.id} onChange={setActiveRole} />
                {selected && (
                  <PermissionGate resource="role" action="update">
                    <Button variant="secondary" onClick={() => setEditRole(selected)}>Manage permissions</Button>
                  </PermissionGate>
                )}
              </div>
              <Table columns={columns} rows={groups} rowKey={(g) => g.resource} empty={<EmptyState title="No permissions" message="The permission catalogue is empty." />} />
            </>
          )}
        </>
      )}

      <CreateRoleDialog open={createOpen} onClose={() => setCreateOpen(false)} catalogue={catalogue || []} onCreated={() => { rolesQuery.retry(); push('Role created.', 'success'); }} />
      <ManagePermissionsDialog open={!!editRole} onClose={() => setEditRole(null)} role={editRole} catalogue={catalogue || []} onSaved={() => { rolesQuery.retry(); push('Permissions updated.', 'success'); }} />
    </PageShell>
  );
}
