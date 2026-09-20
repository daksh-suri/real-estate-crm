import PageShell, { PageHeader } from '../components/layout/PageShell';
import { EmptyState, ErrorState, Pagination, Skeleton, Table } from '../components/ui/data';
import { Button } from '../components/ui/controls';
import { EntityLink, FilterBar, SearchInput } from '../components/crm/crm';
import { RelatedName, useRelatedNames } from '../components/crm/RelatedName';
import { useApi } from '../hooks/useApi';
import { useUrlListState } from '../hooks/useUrlListState';
import { formatDateTime, prettifyEnum, shortId } from '../lib/format';
import { LogActivityButton } from './activities/LogActivityDialog';

// Communication V1 is a history view over Activity — there is no
// Communication entity. Direction is convention-encoded in `outcome`:
// only an INBOUND_/OUTBOUND_ prefix is unambiguous. Anything else (and
// `type` alone) displays neutrally — never guessed.
export function directionOf({ type, outcome } = {}) {
  void type;
  if (typeof outcome !== 'string') return null;
  const prefix = outcome.trim().toUpperCase().split('_')[0];
  if (prefix === 'INBOUND') return 'inbound';
  if (prefix === 'OUTBOUND') return 'outbound';
  return null;
}

function outcomeLabel(outcome) {
  if (!outcome) return null;
  const direction = directionOf({ outcome });
  if (!direction) return prettifyEnum(outcome);
  const rest = outcome.trim().split('_').slice(1).join('_');
  return prettifyEnum(rest || outcome);
}

export function channelMatches(activity, channel) {
  if (!channel) return true;
  return String(activity.type ?? '').toLowerCase().includes(channel.toLowerCase());
}

// Pure path builders (unit-tested): the page fetches nothing else.
export function timelinePath(contactId, limit, offset) {
  return `/activities?contactId=${contactId}&limit=${limit}&offset=${offset}`;
}

export function contactSearchPath(search) {
  const q = new URLSearchParams({ limit: '20', offset: '0' });
  if (search.trim()) q.set('search', search.trim());
  return `/contacts?${q.toString()}`;
}

// Contact-scoped communication history (Checkpoint 17F). Reads GET
// /activities?contactId=… and GET /contacts/:id only; writes go through the
// existing LogActivityDialog (POST /activities, idempotent). No messaging
// infrastructure, no auto-completion of tasks.
export default function CommunicationPage() {
  const { search, limit, offset, filters, setSearch, setFilter, setPage } = useUrlListState([
    'contactId',
    'channel',
  ]);
  const contactId = filters.contactId ?? null;
  const channel = filters.channel ?? '';

  // Contact picker: first page of matches, fetched only while searching.
  const picker = useApi(contactSearchPath(search), { enabled: !contactId && search.trim() !== '' });
  const picks = picker.data ?? null;

  const contact = useApi(contactId ? `/contacts/${contactId}` : '', { enabled: Boolean(contactId) });
  const contactRow = contact.data ?? null;

  const timeline = useApi(contactId ? timelinePath(contactId, limit, offset) : '', {
    enabled: Boolean(contactId),
  });
  const activities = timeline.data ?? null;
  const visible = (activities ?? []).filter((a) => channelMatches(a, channel));
  const maps = useRelatedNames(visible, [
    { key: 'leadId', kind: 'lead' },
    { key: 'dealId', kind: 'deal' },
  ]);

  const columns = [
    { key: 'type', label: 'Channel', render: (r) => <span>{prettifyEnum(r.type)}</span> },
    {
      key: 'direction',
      label: 'Direction',
      render: (r) => {
        const d = directionOf(r);
        if (d === 'inbound') return <span>Inbound</span>;
        if (d === 'outbound') return <span>Outbound</span>;
        return <span className="muted">—</span>;
      },
    },
    { key: 'outcome', label: 'Outcome', render: (r) => (r.outcome ? <span>{outcomeLabel(r.outcome)}</span> : <span className="muted">—</span>) },
    { key: 'notes', label: 'Notes', render: (r) => (r.notes ? <span title={r.notes}>{r.notes.slice(0, 80)}{r.notes.length > 80 ? '…' : ''}</span> : <span className="muted">—</span>) },
    { key: 'leadId', label: 'Lead', render: (r) => (r.leadId ? <RelatedName kind="lead" id={r.leadId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'dealId', label: 'Deal', render: (r) => (r.dealId ? <RelatedName kind="deal" id={r.dealId} maps={maps} /> : <span className="muted">—</span>) },
    { key: 'createdBy', label: 'Logged by', render: (r) => <span title={r.createdBy}>{shortId(r.createdBy)}</span> },
    { key: 'createdAt', label: 'Logged at', render: (r) => formatDateTime(r.createdAt) },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Communication"
        title="Communication"
        description="Agent-managed interaction history. Every entry is an immutable Activity — logging here never completes a task."
        actions={
          contactId ? (
            <>
              <Button variant="secondary" onClick={() => setFilter('contactId', '')}>
                Change contact
              </Button>
              <LogActivityButton contactId={contactId} onLogged={timeline.retry} />
            </>
          ) : null
        }
      />

      {!contactId && (
        <>
          <FilterBar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone, or email…" />
          </FilterBar>
          {search.trim() === '' && (
            <EmptyState
              title="Select a contact"
              message="Communication history is contact-scoped. Search above to pick the contact whose interactions you want to see."
            />
          )}
          {search.trim() !== '' && picker.loading && <Skeleton lines={4} />}
          {search.trim() !== '' && picker.error && !picker.loading && (
            <ErrorState message={picker.error.message} onRetry={picker.retry} />
          )}
          {search.trim() !== '' && !picker.loading && !picker.error && (
            <>
              <Table
                columns={[
                  { key: 'name', label: 'Name', render: (r) => <span>{r.name}</span> },
                  { key: 'phone', label: 'Phone', render: (r) => r.phone || <span className="muted">—</span> },
                  { key: 'email', label: 'Email', render: (r) => r.email || <span className="muted">—</span> },
                  {
                    key: 'pick',
                    label: '',
                    render: (r) => (
                      <Button variant="secondary" onClick={() => setFilter('contactId', r.id)}>
                        Select
                      </Button>
                    ),
                  },
                ]}
                rows={picks}
                rowKey={(r) => r.id}
                empty={
                  <EmptyState
                    title="No contacts match this search"
                    message="Try a different name, phone, or email."
                  />
                }
              />
              {(picks || []).length >= 20 && (
                <p className="muted">Showing the first 20 matches — refine the search to narrow it down.</p>
              )}
            </>
          )}
        </>
      )}

      {contactId && (
        <>
          {contact.loading && <Skeleton lines={2} />}
          {contact.error && !contact.loading && <ErrorState message={contact.error.message} onRetry={contact.retry} />}
          {!contact.loading && !contact.error && contactRow && (
            <p className="muted">
              History for <EntityLink to={`/app/contacts/${contactRow.id}`}>{contactRow.name}</EntityLink>
              {' · '}consent: {prettifyEnum(contactRow.communicationConsent)} (informational — logging is always allowed)
              {' · '}follow-ups live on <EntityLink to="/app/tasks">tasks</EntityLink>
            </p>
          )}

          <FilterBar>
            <SearchInput
              value={channel}
              onChange={(v) => setFilter('channel', v)}
              placeholder="Filter channel on this page (e.g. CALL)…"
            />
          </FilterBar>
          {channel && <p className="muted">Channel filter applies to the currently loaded page only.</p>}

          {timeline.loading && <Skeleton lines={6} />}
          {timeline.error && !timeline.loading && <ErrorState message={timeline.error.message} onRetry={timeline.retry} />}
          {!timeline.loading && !timeline.error && (
            <>
              <Table
                columns={columns}
                rows={visible}
                rowKey={(r) => r.id}
                empty={
                  <EmptyState
                    title="No communication yet"
                    message="Log the first interaction. Entries appear here as immutable history."
                    action={<LogActivityButton contactId={contactId} onLogged={timeline.retry} />}
                  />
                }
              />
              <Pagination
                limit={limit}
                offset={offset}
                hasMore={(activities || []).length === limit}
                onChange={(next) => setPage(next / limit + 1)}
              />
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
