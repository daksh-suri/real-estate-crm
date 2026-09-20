import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, FilterBar, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { Select } from '../../components/ui/controls';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useUrlListState } from '../../hooks/useUrlListState';
import { formatDateTime, fromInputValue, shortId } from '../../lib/format';

// Task = what needs to happen. OPEN → DONE via the dedicated endpoint only;
// DONE is terminal (no reopen). OVERDUE is derived (OPEN + past dueAt).
export function isTaskOverdue(task) {
  return !!task && task.status === 'OPEN' && new Date(task.dueAt).getTime() < Date.now();
}

export function taskDisplayStatus(task) {
  if (!task) return '—';
  return isTaskOverdue(task) ? 'OVERDUE' : task.status;
}

function CreateTaskDialog({ open, onClose, onCreated }) {
  const { api } = useAuth();
  const [assignedTo, setAssignedTo] = useState('');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [relatedContactId, setRelatedContactId] = useState('');
  const [relatedDealId, setRelatedDealId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  // Stable per mount: a timeout retry replays instead of forking a duplicate.
  const idempotencyKey = useIdempotencyKey();

  const opt = (v) => (v.trim() === '' ? null : v.trim());

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const due = fromInputValue(dueAt);
      if (!due) throw Object.assign(new Error('Task needs a valid due date.'), { statusCode: 400 });
      const task = await api('/tasks', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          assignedTo: assignedTo.trim(),
          title: title.trim(),
          dueAt: due,
          relatedContactId: opt(relatedContactId),
          relatedDealId: opt(relatedDealId),
        },
      });
      onCreated?.(task);
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
      title="New task"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>{pending ? 'Creating…' : 'Create task'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Assignee ID" hint="Must be an ACTIVE user in your organization.">
          <Input value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setError(null); }} placeholder="UUID" required />
        </Field>
        <Field label="Title">
          <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(null); }} required maxLength={200} />
        </Field>
        <Field label="Due at">
          <Input type="datetime-local" value={dueAt} onChange={(e) => { setDueAt(e.target.value); setError(null); }} required />
        </Field>
        <Field label="Related contact ID (optional)">
          <Input value={relatedContactId} onChange={(e) => { setRelatedContactId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        <Field label="Related deal ID (optional)">
          <Input value={relatedDealId} onChange={(e) => { setRelatedDealId(e.target.value); setError(null); }} placeholder="UUID" />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

export default function TasksPage() {
  const { limit, offset, filters, setFilter, setPage } = useUrlListState(['status']);
  const [createOpen, setCreateOpen] = useState(false);
  const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.status) q.set('status', filters.status);
  const { data, error, loading, retry } = useApi(`/tasks?${q.toString()}`);
  const rows = data ?? null;
  const maps = useRelatedNames(rows, [
    { key: 'relatedContactId', kind: 'contact' },
    { key: 'relatedDealId', kind: 'deal' },
  ]);

  const columns = [
    { key: 'title', label: 'Task', render: (r) => <EntityLink to={`/app/tasks/${r.id}`}>{r.title}</EntityLink> },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={taskDisplayStatus(r)} /> },
    { key: 'dueAt', label: 'Due', render: (r) => formatDateTime(r.dueAt) },
    { key: 'assignedTo', label: 'Assignee', render: (r) => <span title={r.assignedTo}>{shortId(r.assignedTo)}</span> },
    { key: 'relatedContactId', label: 'Contact', render: (r) => (r.relatedContactId ? <RelatedName kind="contact" id={r.relatedContactId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'relatedDealId', label: 'Deal', render: (r) => (r.relatedDealId ? <RelatedName kind="deal" id={r.relatedDealId} maps={maps} /> : <span className="muted">—</span>) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Tasks"
        description="What needs to happen. Tasks complete once via the dedicated endpoint — DONE is terminal."
        actions={
          <PermissionGate resource="task" action="create">
            <Button variant="primary" onClick={() => setCreateOpen(true)}>New task</Button>
          </PermissionGate>
        }
      />
      <FilterBar>
        <Select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="DONE">Done</option>
          <option value="OVERDUE">Overdue</option>
        </Select>
      </FilterBar>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={retry} />}
      {!loading && !error && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No tasks match these filters" message="Create the first task, or log an activity with a follow-up." />}
          />
          <Pagination limit={limit} offset={offset} hasMore={(rows || []).length === limit} onChange={(next) => setPage(next / limit + 1)} />
        </>
      )}

      {createOpen && (
        <CreateTaskDialog
          open
          onClose={() => setCreateOpen(false)}
          onCreated={() => { retry(); }}
        />
      )}
    </PageShell>
  );
}

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function TaskDetail({ taskId }) {
  const { api } = useAuth();
  const { push } = useToast();
  const { data: task, error, loading, retry } = useApi(`/tasks/${taskId}`);
  const maps = useRelatedNames(task ? [task] : null, [
    { key: 'relatedContactId', kind: 'contact' },
    { key: 'relatedDealId', kind: 'deal' },
  ]);
  const [pending, setPending] = useState(false);

  async function onComplete() {
    if (pending) return;
    setPending(true);
    try {
      await api(`/tasks/${taskId}/complete`, { method: 'POST' });
      push('Task completed.', 'success');
      retry();
    } catch (err) {
      push(err.message || 'Completion failed.', 'error');
    } finally {
      setPending(false);
    }
  }

  if (loading) return <Skeleton lines={4} />;
  if (error || !task) return <ErrorState message={error?.message} onRetry={retry} />;
  const done = task.status === 'DONE';

  return (
    <div className="section-stack">
      <Card title={task.title}>
        <dl className="detail-list">
          <Row label="Status"><StatusBadge status={taskDisplayStatus(task)} /></Row>
          <Row label="Due">{formatDateTime(task.dueAt)}</Row>
          <Row label="Assignee"><span title={task.assignedTo}>{shortId(task.assignedTo)}</span></Row>
          <Row label="Contact">
            {task.relatedContactId ? <RelatedName kind="contact" id={task.relatedContactId} maps={maps} /> : <span className="muted">—</span>}
          </Row>
          <Row label="Deal">
            {task.relatedDealId ? <RelatedName kind="deal" id={task.relatedDealId} maps={maps} /> : <span className="muted">—</span>}
          </Row>
          <Row label="Created by"><span title={task.createdBy}>{shortId(task.createdBy)}</span></Row>
          <Row label="Created">{formatDateTime(task.createdAt)}</Row>
        </dl>
      </Card>
      <Card title="Completion">
        {done ? (
          <p className="muted">DONE is terminal — this task cannot be reopened.</p>
        ) : (
          <PermissionGate resource="task" action="complete" fallback={<p className="muted">You lack permission to complete this task.</p>}>
            <Button variant="primary" onClick={onComplete} disabled={pending}>
              {pending ? 'Completing…' : 'Mark done'}
            </Button>
          </PermissionGate>
        )}
      </Card>
    </div>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  return (
    <PageShell>
      <PageHeader
        eyebrow="Task"
        title="Task detail"
        actions={<Link className="btn btn--secondary btn--md" to="/app/tasks">← All tasks</Link>}
      />
      <TaskDetail taskId={id} />
    </PageShell>
  );
}
