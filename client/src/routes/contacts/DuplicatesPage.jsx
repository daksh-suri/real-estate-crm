import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Input } from '../../components/ui/controls';
import { ConfirmDialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/data';
import { EntityLink } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';

// Duplicate review + merge. Frontend only selects IDs and presents results;
// the merge itself is the authoritative backend transaction.
export default function DuplicatesPage() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [contactAId, setContactAId] = useState(null);
  const [contactBId, setContactBId] = useState(null);

  const q = new URLSearchParams({ limit: '10', offset: '0' });
  if (submitted) q.set('search', submitted);
  const search = useApi(submitted ? `/contacts?${q.toString()}` : null, { enabled: !!submitted });
  const searchRows = search.data ?? [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contacts"
        title="Duplicate review"
        description="Possible duplicates are a human review queue — nothing here merges automatically. Inspect both records, choose the survivor explicitly, confirm."
        actions={<Link className="btn btn--secondary btn--md" to="/app/contacts">← All contacts</Link>}
      />
      <div className="section-stack">
        <Card title="1 · Find a contact to review">
          <form
            className="merge-pick"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(query.trim());
              setContactAId(null);
              setContactBId(null);
            }}
          >
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, or email…" aria-label="Search contacts" />
            <Button variant="secondary" type="submit">Search</Button>
          </form>
          {search.loading && <Skeleton lines={2} />}
          {search.error && <ErrorState message={search.error.message} onRetry={search.retry} />}
          {!search.loading && submitted && searchRows.length === 0 && !search.error && (
            <EmptyState title="No contacts found" message="Try a different search." />
          )}
          {searchRows.map((c) => (
            <div key={c.id} className="detail-row">
              <dt>{c.name}</dt>
              <dd>
                <span className="muted">{c.phone || c.email || 'no identity'}</span>{' '}
                <Button variant={contactAId === c.id ? 'primary' : 'secondary'} onClick={() => { setContactAId(c.id); setContactBId(null); }}>
                  {contactAId === c.id ? 'Selected' : 'Review'}
                </Button>
              </dd>
            </div>
          ))}
        </Card>

        {contactAId && <PairPicker contactAId={contactAId} contactBId={contactBId} onPick={setContactBId} />}

        {contactAId && contactBId && (
          <MergePair contactAId={contactAId} contactBId={contactBId} onDone={() => setContactBId(null)} />
        )}
      </div>
    </PageShell>
  );
}

function PairPicker({ contactAId, contactBId, onPick }) {
  const { data, error, loading, retry } = useApi(`/contacts/${contactAId}/possible-duplicates`);
  const pairs = (data ?? []).filter((p) => p.status === 'PENDING');
  const { data: contactA } = useApi(`/contacts/${contactAId}`);

  if (loading) return <Card title="2 · Possible duplicates"><Skeleton lines={2} /></Card>;
  if (error) return <Card title="2 · Possible duplicates"><ErrorState message={error.message} onRetry={retry} /></Card>;
  if (pairs.length === 0) {
    return (
      <Card title="2 · Possible duplicates">
        <EmptyState
          title="No pending duplicates"
          message={`${contactA?.name ?? 'This contact'} has no PENDING duplicate pairs. Single-signal intake matches create them automatically.`}
        />
      </Card>
    );
  }
  return (
    <Card title="2 · Choose the other record">
      {pairs.map((p) => {
        const otherId = p.contactAId === contactAId ? p.contactBId : p.contactAId;
        return (
          <PairOption key={p.id} otherId={otherId} signal={p.matchSignal} active={contactBId === otherId} onPick={() => onPick(otherId)} />
        );
      })}
    </Card>
  );
}

function PairOption({ otherId, signal, active, onPick }) {
  const { data } = useApi(`/contacts/${otherId}`);
  return (
    <div className="detail-row">
      <dt>{data ? data.name : 'Loading…'}</dt>
      <dd>
        <span className="muted">{data ? `${data.phone || '—'} · ${data.email || '—'} · signal ${signal}` : ''}</span>{' '}
        <Button variant={active ? 'primary' : 'secondary'} onClick={onPick}>
          {active ? 'Selected' : 'Compare'}
        </Button>
      </dd>
    </div>
  );
}

function useContactBundle(id) {
  const contact = useApi(`/contacts/${id}`);
  const requirements = useApi(`/contacts/${id}/requirements`);
  const enquiries = useApi(`/enquiries?contactId=${id}&limit=100&offset=0`);
  const leads = useApi(`/leads?contactId=${id}&limit=100&offset=0`);
  const deals = useApi(`/deals?contactId=${id}&limit=100&offset=0`);
  return { contact, requirements, enquiries, leads, deals };
}

function BundleCard({ title, bundle, contactId }) {
  const c = bundle.contact.data;
  const count = (u) => (u.data ? u.data.length : '…');
  if (bundle.contact.loading) return <Card title={title}><Skeleton lines={4} /></Card>;
  if (bundle.contact.error || !c) return <Card title={title}><ErrorState message={bundle.contact.error?.message} onRetry={bundle.contact.retry} /></Card>;
  return (
    <Card title={title}>
      <dl className="detail-list">
        <div className="detail-row"><dt>Name</dt><dd><EntityLink to={`/app/contacts/${contactId}`}>{c.name}</EntityLink></dd></div>
        <div className="detail-row"><dt>Phone</dt><dd>{c.phone || '—'}</dd></div>
        <div className="detail-row"><dt>Email</dt><dd>{c.email || '—'}</dd></div>
        <div className="detail-row"><dt>Requirements</dt><dd>{count(bundle.requirements)}</dd></div>
        <div className="detail-row"><dt>Enquiries</dt><dd>{count(bundle.enquiries)}</dd></div>
        <div className="detail-row"><dt>Leads</dt><dd>{count(bundle.leads)}</dd></div>
        <div className="detail-row"><dt>Deals</dt><dd>{count(bundle.deals)}</dd></div>
        <div className="detail-row"><dt>Created</dt><dd>{formatDateTime(c.createdAt)}</dd></div>
      </dl>
    </Card>
  );
}

function MergePair({ contactAId, contactBId, onDone }) {
  const { api } = useAuth();
  const { push } = useToast();
  const bundleA = useContactBundle(contactAId);
  const bundleB = useContactBundle(contactBId);
  const [survivorId, setSurvivorId] = useState(contactAId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const nameA = bundleA.contact.data?.name ?? 'Contact A';
  const nameB = bundleB.contact.data?.name ?? 'Contact B';

  async function onMerge() {
    if (pending) return;
    setPending(true);
    const duplicateId = survivorId === contactAId ? contactBId : contactAId;
    try {
      await api(`/contacts/${duplicateId}/merge`, { method: 'POST', body: { targetId: survivorId } });
      push('Contacts merged. History moved to the survivor.', 'success');
      setConfirmOpen(false);
      onDone();
    } catch (err) {
      push(err.message || 'Merge failed.', 'error');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="3 · Compare and merge">
      <div className="merge-grid">
        <BundleCard title="Record A" bundle={bundleA} contactId={contactAId} />
        <BundleCard title="Record B" bundle={bundleB} contactId={contactBId} />
      </div>
      <div className="detail-row" style={{ marginTop: '1rem' }}>
        <dt>Survivor (kept)</dt>
        <dd>
          <div className="merge-pick" role="radiogroup" aria-label="Survivor">
            {[
              [contactAId, nameA],
              [contactBId, nameB],
            ].map(([id, name]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={survivorId === id}
                className={`merge-pick__option${survivorId === id ? ' merge-pick__option--active' : ''}`}
                onClick={() => setSurvivorId(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </dd>
      </div>
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        Merging moves requirements, enquiries, leads, deals, visits, activities, and documents to the survivor, then
        archives the other record. This cannot be undone from the UI.
      </p>
      <PermissionGate resource="contact" action="update">
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Merge contacts
        </Button>
      </PermissionGate>
      <ConfirmDialog
        open={confirmOpen}
        title="Merge contacts"
        message={`Archive "${survivorId === contactAId ? nameB : nameA}" into "${survivorId === contactAId ? nameA : nameB}"? All history moves to the survivor.`}
        confirmLabel={pending ? 'Merging…' : 'Merge contacts'}
        onClose={() => { if (!pending) setConfirmOpen(false); }}
        onConfirm={onMerge}
      />
    </Card>
  );
}
