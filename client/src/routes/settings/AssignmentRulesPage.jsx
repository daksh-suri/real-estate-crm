import { useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';

// V1 supports ROUND_ROBIN only (DEC-015). The counter itself stays
// backend-controlled — this UI never calculates the next assignee.
const RULE_TYPES = ['ROUND_ROBIN'];

function RuleDialog({ open, onClose, rule, teams, onSaved }) {
  const { api } = useAuth();
  const [type, setType] = useState(rule?.type ?? 'ROUND_ROBIN');
  const [order, setOrder] = useState(rule?.order ?? 0);
  const [teamId, setTeamId] = useState(rule?.config?.teamId ?? '');
  const [active, setActive] = useState(rule ? !!rule.active : true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const body = { type, order: Number(order), config: { teamId }, active };
      const path = rule ? `/assignment-rules/${rule.id}` : '/assignment-rules';
      await api(path, { method: rule ? 'PATCH' : 'POST', body });
      onSaved();
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
      title={rule ? 'Edit assignment rule' : 'New assignment rule'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save rule'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Type">
          <Select value={type} onChange={(e) => { setType(e.target.value); setError(null); }}>
            {RULE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </Select>
        </Field>
        <Field label="Order" hint="Lower runs first.">
          <Input type="number" value={order} min={0} onChange={(e) => { setOrder(e.target.value); setError(null); }} />
        </Field>
        <Field label="Team" hint="Round-robin rotates over the active members of this team.">
          <Select value={teamId} onChange={(e) => { setTeamId(e.target.value); setError(null); }} required>
            <option value="">Select a team…</option>
            {(teams || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Active">
          <Select value={active ? 'yes' : 'no'} onChange={(e) => setActive(e.target.value === 'yes')}>
            <option value="yes">Enabled</option>
            <option value="no">Disabled</option>
          </Select>
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function AssignmentRulesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { api } = useAuth();
  const { push } = useToast();

  const { data, error, loading, retry } = useApi('/assignment-rules?limit=100&offset=0');
  const rows = data ?? null;
  const teamsQuery = useApi('/teams');
  const teams = teamsQuery.data ?? [];
  const teamNames = Object.fromEntries((teams || []).map((t) => [t.id, t.name]));

  async function onToggle(rule) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/assignment-rules/${rule.id}`, { method: 'PATCH', body: { active: !rule.active } });
      push(rule.active ? 'Rule disabled.' : 'Rule enabled.', 'success');
      retry();
    } catch (err) {
      push(err.message || 'Could not update rule.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/assignment-rules/${deleting.id}`, { method: 'DELETE' });
      push('Assignment rule deleted.', 'success');
      setDeleting(null);
      retry();
    } catch (err) {
      push(err.message || 'Could not delete rule.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    { key: 'type', label: 'Type', render: (r) => r.type.replace(/_/g, ' ') },
    { key: 'order', label: 'Order', render: (r) => r.order },
    { key: 'team', label: 'Team', render: (r) => teamNames[r.config?.teamId] || <span className="muted">—</span> },
    { key: 'active', label: 'State', render: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'INACTIVE'} /> },
    { key: 'createdAt', label: 'Created', render: (r) => formatDateTime(r.createdAt) },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <span className="row-actions">
          <PermissionGate resource="assignmentRule" action="update">
            <Button variant="ghost" onClick={() => onToggle(r)} disabled={busy}>{r.active ? 'Disable' : 'Enable'}</Button>
            <Button variant="ghost" onClick={() => { setEditing(r); setDialogOpen(true); }}>Edit</Button>
          </PermissionGate>
          <PermissionGate resource="assignmentRule" action="delete">
            <Button variant="ghost" onClick={() => setDeleting(r)}>Delete</Button>
          </PermissionGate>
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Assignment rules"
        description="How new leads are assigned, lowest order first. The next-assignee counter stays backend-controlled."
        actions={
          <PermissionGate resource="assignmentRule" action="create">
            <Button variant="primary" onClick={() => { setEditing(null); setDialogOpen(true); }}>New rule</Button>
          </PermissionGate>
        }
      />
      <Card title="Round-robin only">
        <p className="muted">V1 supports ROUND_ROBIN over the active members of a team. Territory, project-affinity, and scoring rules are deferred.</p>
      </Card>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<EmptyState title="No assignment rules" message="Without rules, new leads stay unassigned for manager review." />}
        />
      )}

      <RuleDialog
        open={dialogOpen}
        rule={editing}
        teams={teams}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={() => { retry(); push(editing ? 'Rule updated.' : 'Rule created.', 'success'); }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete assignment rule"
        message="Delete this rule? Future leads skip it; already-assigned leads are unaffected."
        confirmLabel={busy ? 'Deleting…' : 'Delete rule'}
        onClose={() => { if (!busy) setDeleting(null); }}
        onConfirm={onDelete}
      />
    </PageShell>
  );
}
