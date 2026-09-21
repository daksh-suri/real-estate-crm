import { useEffect, useState } from 'react';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input, Select } from '../../components/ui/controls';
import { Dialog, ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { FilterBar, SearchInput, StatusBadge } from '../../components/crm/crm';
import { Badge } from '../../components/ui/controls';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, shortId } from '../../lib/format';

function TeamDialog({ open, onClose, team, onSaved }) {
  const { api } = useAuth();
  const [name, setName] = useState(team?.name ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName(team?.name ?? '');
      setError(null);
    }
  }, [open, team]);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const path = team ? `/teams/${team.id}` : '/teams';
      await api(path, { method: team ? 'PATCH' : 'POST', body: { name: name.trim() } });
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
      title={team ? 'Rename team' : 'New team'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Saving…' : 'Save team'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function EmployeeDialog({ open, onClose, roles, teams, onSaved }) {
  const { api } = useAuth();
  const { push } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setPassword('');
      setRoleId('');
      setTeamId('');
      setError(null);
    }
  }, [open]);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await api('/users', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password, roleId },
      });
      if (teamId !== '') {
        await api(`/teams/${teamId}/members`, { method: 'POST', body: { userId: created.id } });
      }
      push(`Employee account created for ${created.email}. Share the initial password out-of-band.`, 'success');
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
      title="Add employee"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Creating…' : 'Create account'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Name">
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} required minLength={2} maxLength={100} />
        </Field>
        <Field label="Email" hint="Login identifier, unique in this organization.">
          <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} required maxLength={255} />
        </Field>
        <Field label="Initial password" hint="Min 8 characters. Share it with the employee directly — email invites are deferred.">
          <Input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} required minLength={8} maxLength={72} />
        </Field>
        <Field label="Role">
          <Select value={roleId} onChange={(e) => { setRoleId(e.target.value); setError(null); }} required>
            <option value="">Select a role…</option>
            {(roles || []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Team (optional)">
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team yet</option>
            {(teams || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function MemberPicker({ teamId, existingIds, onAdded }) {
  const { api } = useAuth();
  const { push } = useToast();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);
  const { data, error, loading } = useApi(q.trim().length >= 2 ? `/users?search=${encodeURIComponent(q.trim())}&limit=20&offset=0` : null, { enabled: q.trim().length >= 2 });
  const candidates = (data || []).filter((u) => !existingIds.has(u.id));

  async function add(user) {
    if (adding) return;
    setAdding(user.id);
    try {
      await api(`/teams/${teamId}/members`, { method: 'POST', body: { userId: user.id } });
      push(`${user.name} added to the team.`, 'success');
      setQ('');
      onAdded();
    } catch (err) {
      push(err.message || 'Could not add member.', 'error');
    } finally {
      setAdding(null);
    }
  }

  return (
    <div>
      <SearchInput value={q} onChange={setQ} placeholder="Search employees to add… (min 2 chars)" />
      {loading && <Skeleton lines={2} />}
      {error && !loading && <ErrorState message={error.message} />}
      {!loading && !error && q.trim().length >= 2 && (
        <Table
          columns={[
            { key: 'name', label: 'Employee', render: (u) => <span title={u.id}>{u.name}</span> },
            { key: 'email', label: 'Email', render: (u) => u.email },
            {
              key: 'add',
              label: '',
              render: (u) => <Button variant="ghost" onClick={() => add(u)} disabled={adding === u.id}>{adding === u.id ? 'Adding…' : 'Add'}</Button>,
            },
          ]}
          rows={candidates}
          rowKey={(u) => u.id}
          empty={<EmptyState title="No matches" message="Everyone matching is already on this team, or try another search." />}
        />
      )}
    </div>
  );
}

export default function TeamPage() {
  const { search, limit, offset, setSearch, setPage } = useUrlListState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [deletingTeam, setDeletingTeam] = useState(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const { api } = useAuth();
  const { push } = useToast();

  const uq = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) uq.set('search', search);
  if (statusFilter) uq.set('status', statusFilter);
  const directory = useApi(`/users?${uq.toString()}`);
  const users = directory.data ?? null;

  const teamsQuery = useApi('/teams');
  const teams = teamsQuery.data ?? [];
  const rolesQuery = useApi('/roles');
  const roles = rolesQuery.data ?? [];
  const selectedTeam = (teams || []).find((t) => t.id === selectedTeamId) || null;
  const membersQuery = useApi(selectedTeamId ? `/teams/${selectedTeamId}/members` : null, { enabled: !!selectedTeamId });
  const members = membersQuery.data ?? [];
  const memberIds = new Set((members || []).map((m) => m.user.id));

  async function onDeleteTeam() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/teams/${deletingTeam.id}`, { method: 'DELETE' });
      push('Team deleted. Members keep their accounts.', 'success');
      if (selectedTeamId === deletingTeam.id) setSelectedTeamId(null);
      setDeletingTeam(null);
      teamsQuery.retry();
      directory.retry();
    } catch (err) {
      push(err.message || 'Could not delete team.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveMember() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/teams/${selectedTeamId}/members/${removing.user.id}`, { method: 'DELETE' });
      push('Member removed from the team.', 'success');
      setRemoving(null);
      membersQuery.retry();
      directory.retry();
    } catch (err) {
      push(err.message || 'Could not remove member.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Team"
        description="Employees, teams, and membership. Deactivation and invite emails are deferred — see each section."
        actions={
          <PermissionGate resource="user" action="create">
            <Button variant="primary" onClick={() => setEmployeeOpen(true)}>Add employee</Button>
          </PermissionGate>
        }
      />

      <Card title="Employees">
        <FilterBar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or email…" />
          <Select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="DEACTIVATED">Deactivated</option>
          </Select>
        </FilterBar>
        {directory.loading && <Skeleton lines={5} />}
        {directory.error && !directory.loading && <ErrorState message={directory.error.message} onRetry={directory.retry} />}
        {!directory.loading && !directory.error && (
          <>
            <Table
              columns={[
                { key: 'name', label: 'Name', render: (u) => <span title={u.id}>{u.name}</span> },
                { key: 'email', label: 'Email', render: (u) => u.email },
                { key: 'status', label: 'Status', render: (u) => <StatusBadge status={u.status} /> },
                { key: 'roleName', label: 'Role', render: (u) => u.roleName ? <Badge tone="neutral">{u.roleName}</Badge> : <span className="muted">—</span> },
                { key: 'teams', label: 'Teams', render: (u) => (u.teams || []).map((t) => t.name).join(', ') || <span className="muted">—</span> },
              ]}
              rows={users}
              rowKey={(u) => u.id}
              empty={<EmptyState title={search ? 'No employees match' : 'No employees yet'} message={search ? 'Try a different search.' : 'Add the first employee account.'} />}
            />
            <Pagination limit={limit} offset={offset} hasMore={(users || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
          </>
        )}
      </Card>

      <Card title="Teams">
        {teamsQuery.loading && <Skeleton lines={3} />}
        {teamsQuery.error && !teamsQuery.loading && <ErrorState message={teamsQuery.error.message} onRetry={teamsQuery.retry} />}
        {!teamsQuery.loading && !teamsQuery.error && (
          <Table
            columns={[
              { key: 'name', label: 'Team', render: (t) => t.name },
              { key: 'createdAt', label: 'Created', render: (t) => formatDateTime(t.createdAt) },
              {
                key: 'actions',
                label: 'Actions',
                render: (t) => (
                  <span className="row-actions">
                    <Button variant="ghost" onClick={() => setSelectedTeamId(t.id)}>Members</Button>
                    <PermissionGate resource="team" action="update">
                      <Button variant="ghost" onClick={() => { setEditingTeam(t); setTeamDialogOpen(true); }}>Rename</Button>
                    </PermissionGate>
                    <PermissionGate resource="team" action="delete">
                      <Button variant="ghost" onClick={() => setDeletingTeam(t)}>Delete</Button>
                    </PermissionGate>
                  </span>
                ),
              },
            ]}
            rows={teams}
            rowKey={(t) => t.id}
            empty={<EmptyState title="No teams yet" message="Create the first team to group employees." />}
          />
        )}
        <PermissionGate resource="team" action="create">
          <p><Button variant="primary" onClick={() => { setEditingTeam(null); setTeamDialogOpen(true); }}>New team</Button></p>
        </PermissionGate>
      </Card>

      {selectedTeam && (
        <Card title={`Members — ${selectedTeam.name}`}>
          {membersQuery.loading && <Skeleton lines={3} />}
          {membersQuery.error && !membersQuery.loading && <ErrorState message={membersQuery.error.message} onRetry={membersQuery.retry} />}
          {!membersQuery.loading && !membersQuery.error && (
            <Table
              columns={[
                { key: 'name', label: 'Member', render: (m) => <span title={m.user.id}>{m.user.name}</span> },
                { key: 'email', label: 'Email', render: (m) => m.user.email },
                {
                  key: 'remove',
                  label: '',
                  render: (m) => (
                    <PermissionGate resource="team" action="manage_members">
                      <Button variant="ghost" onClick={() => setRemoving(m)}>Remove</Button>
                    </PermissionGate>
                  ),
                },
              ]}
              rows={members}
              rowKey={(m) => m.membershipId || m.user.id}
              empty={<EmptyState title="No members" message="Search employees below to add the first member." />}
            />
          )}
          <PermissionGate resource="team" action="manage_members">
            <MemberPicker teamId={selectedTeam.id} existingIds={memberIds} onAdded={() => { membersQuery.retry(); directory.retry(); }} />
          </PermissionGate>
        </Card>
      )}

      <TeamDialog
        open={teamDialogOpen}
        team={editingTeam}
        onClose={() => { setTeamDialogOpen(false); setEditingTeam(null); }}
        onSaved={() => { teamsQuery.retry(); push(editingTeam ? 'Team renamed.' : 'Team created.', 'success'); }}
      />
      <EmployeeDialog
        open={employeeOpen}
        roles={roles}
        teams={teams}
        onClose={() => setEmployeeOpen(false)}
        onSaved={() => { directory.retry(); teamsQuery.retry(); if (selectedTeamId) membersQuery.retry(); }}
      />
      <ConfirmDialog
        open={!!deletingTeam}
        title="Delete team"
        message={`Delete "${deletingTeam?.name}"? Memberships are removed; member accounts are kept.`}
        confirmLabel={busy ? 'Deleting…' : 'Delete team'}
        onClose={() => { if (!busy) setDeletingTeam(null); }}
        onConfirm={onDeleteTeam}
      />
      <ConfirmDialog
        open={!!removing}
        title="Remove member"
        message={`Remove ${removing?.user.name} from ${selectedTeam?.name}? Their account stays active.`}
        confirmLabel={busy ? 'Removing…' : 'Remove member'}
        onClose={() => { if (!busy) setRemoving(null); }}
        onConfirm={onRemoveMember}
      />
    </PageShell>
  );
}

// Pure helper (unit-tested): member display name with short-ID fallback.
export function teamMemberName(m) {
  return m?.user?.name ?? shortId(m?.user?.id);
}
