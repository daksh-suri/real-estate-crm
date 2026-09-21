import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card } from '../../components/ui/controls';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';
import './calendar.css';

function monthRange(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function toISO(d) {
  return d.toISOString();
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, n) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1);
}

function monthLabel(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function CalendarPage() {
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => startOfMonth(today));
  const [selected, setSelected] = useState(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()));

  const { start, end } = useMemo(() => monthRange(cursor), [cursor]);

  const visitsQuery = useApi(`/site-visits?from=${encodeURIComponent(toISO(start))}&to=${encodeURIComponent(toISO(end))}&limit=100&offset=0`);
  const tasksQuery = useApi('/tasks?limit=100&offset=0');

  const visits = visitsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];

  const visitsByDay = useMemo(() => {
    const m = new Map();
    for (const v of visits) {
      const d = new Date(v.scheduledAt);
      const k = dayKey(d);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    return m;
  }, [visits]);

  const tasksByDay = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      // Only show OPEN tasks (DONE is history)
      if (t.status === 'DONE') continue;
      const d = new Date(t.dueAt);
      const k = dayKey(d);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    }
    return m;
  }, [tasks]);

  const selectedKey = dayKey(selected);
  const selectedVisits = visitsByDay.get(selectedKey) || [];
  const selectedTasks = tasksByDay.get(selectedKey) || [];

  const maps = useRelatedNames([...selectedVisits], [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
  ]);

  // Build month grid: 42 cells (6 weeks)
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startDay = first.getDay(); // 0 Sun
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDay; i++) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - (startDay - i));
      cells.push({ date: d, outside: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(cursor.getFullYear(), cursor.getMonth(), d), outside: false });
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      cells.push({ date: d, outside: true });
    }
    while (cells.length % 7 !== 0) cells.pop();
    return cells.slice(0, 42);
  }, [cursor]);

  const loading = visitsQuery.loading || tasksQuery.loading;
  const error = visitsQuery.error || tasksQuery.error;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Calendar"
        description="Site visits and tasks by date. Internal CRM view — no external calendar sync."
        actions={
          <Button variant="ghost" onClick={() => { const t = startOfMonth(today); setCursor(t); setSelected(new Date(today.getFullYear(), today.getMonth(), today.getDate())); }}>Today</Button>
        }
      />

      <div className="calendar-toolbar">
        <Button variant="secondary" onClick={() => setCursor(addMonths(cursor, -1))}>← Prev</Button>
        <span className="calendar-month-label">{monthLabel(cursor)}</span>
        <Button variant="secondary" onClick={() => setCursor(addMonths(cursor, 1))}>Next →</Button>
      </div>

      {loading && <Skeleton lines={6} />}
      {error && !loading && <ErrorState message={error.message} onRetry={() => { visitsQuery.retry(); tasksQuery.retry(); }} />}

      {!loading && !error && (
        <div className="calendar-layout">
          <Card>
            <div className="calendar-grid" role="grid" aria-label={`Calendar ${monthLabel(cursor)}`}>
              <div className="calendar-weekday" role="row">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => (
                  <div key={w} className="calendar-weekday-cell" role="columnheader">{w}</div>
                ))}
              </div>
              <div className="calendar-cells">
                {grid.map(({ date, outside }) => {
                  const k = dayKey(date);
                  const v = visitsByDay.get(k) || [];
                  const t = tasksByDay.get(k) || [];
                  const isSelected = isSameDay(date, selected);
                  const isToday = isSameDay(date, today);
                  return (
                    <button
                      key={k + String(outside)}
                      type="button"
                      className={`calendar-cell${outside ? ' calendar-cell--outside' : ''}${isSelected ? ' calendar-cell--selected' : ''}${isToday ? ' calendar-cell--today' : ''}`}
                      onClick={() => setSelected(new Date(date.getFullYear(), date.getMonth(), date.getDate()))}
                      aria-selected={isSelected}
                      aria-label={`${k} ${v.length} visits ${t.length} tasks`}
                    >
                      <span className="calendar-cell__day">{date.getDate()}</span>
                      <span className="calendar-cell__dots">
                        {v.length > 0 && <span className="calendar-dot calendar-dot--visit" title={`${v.length} visit(s)`}>{v.length}</span>}
                        {t.length > 0 && <span className="calendar-dot calendar-dot--task" title={`${t.length} task(s)`}>{t.length}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card title={`${selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`} actions={<span className="muted">{selectedVisits.length} visit(s) · {selectedTasks.length} task(s)</span>}>
            {selectedVisits.length === 0 && selectedTasks.length === 0 && (
              <EmptyState title="No schedule" message="No visits or tasks for this date." />
            )}
            {selectedVisits.length > 0 && (
              <>
                <h4 className="calendar-section-title">Site visits</h4>
                <div className="calendar-agenda">
                  {selectedVisits
                    .slice()
                    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
                    .map((v) => (
                      <Link key={v.id} to={`/app/site-visits/${v.id}`} className="calendar-event calendar-event--visit">
                        <span className="calendar-event__time">{new Date(v.scheduledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {v.durationMinutes}m</span>
                        <span className="calendar-event__title"><RelatedName kind="contact" id={v.contactId} maps={maps} /> · <RelatedName kind="project" id={v.projectId} maps={maps} /></span>
                        <span className="calendar-event__meta"><StatusBadge status={v.status} /></span>
                      </Link>
                    ))}
                </div>
              </>
            )}
            {selectedTasks.length > 0 && (
              <>
                <h4 className="calendar-section-title">Tasks due</h4>
                <div className="calendar-agenda">
                  {selectedTasks
                    .slice()
                    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
                    .map((t) => (
                      <Link key={t.id} to={`/app/tasks/${t.id}`} className="calendar-event calendar-event--task">
                        <span className="calendar-event__time">{new Date(t.dueAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="calendar-event__title">{t.title}</span>
                        <span className="calendar-event__meta"><StatusBadge status={t.status} /></span>
                      </Link>
                    ))}
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </PageShell>
  );
}
