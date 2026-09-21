import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card, Field, Textarea } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, shortId } from '../../lib/format';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { UploadDialog } from './UploadDialog';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Review actions allowed per state (backend map, read-only mirror):
// UNDER_REVIEW → verify/reject; REJECTED → resubmit (new row); VERIFIED → none.
export function documentReviewActions(status) {
  if (status === 'UNDER_REVIEW') return ['verify', 'reject'];
  if (status === 'REJECTED') return ['resubmit'];
  return [];
}

function RejectDialog({ open, onClose, documentId, onDone }) {
  const { api } = useAuth();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api(`/documents/${documentId}/reject`, { method: 'POST', body: { rejectionReason: reason.trim() } });
      onDone();
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
      title="Reject document"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={onSubmit} disabled={pending}>{pending ? 'Rejecting…' : 'Reject'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        <Field label="Rejection reason" hint="Required. The agent sees this when resubmitting.">
          <Textarea value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} required maxLength={500} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}

function AccessButton({ documentId }) {
  const { api } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function openAccess() {
    if (pending) return;
    setPending(true);
    setError(null);
    // Open synchronously to preserve the user gesture; navigate after await.
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) {
      setError({ message: 'Pop-up blocked. Allow pop-ups for this site and try again.' });
      setPending(false);
      return;
    }
    try {
      const { url } = await api(`/documents/${documentId}/access-url`, { method: 'POST' });
      w.location.href = url;
    } catch (err) {
      w.close();
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <span>
      <PermissionGate resource="document" action="read">
        <Button variant="secondary" onClick={openAccess} disabled={pending}>{pending ? 'Opening…' : 'View file'}</Button>
      </PermissionGate>
      {error && <span className="form-field__error" role="alert"> {error.message}</span>}
    </span>
  );
}

export default function DocumentDetailPage() {
  const { id } = useParams();
  const { api } = useAuth();
  const { push } = useToast();
  const resubmitKey = useIdempotencyKey();
  const { data: doc, error, loading, retry } = useApi(`/documents/${id}`);
  const maps = useRelatedNames(doc ? [doc] : null, [
    { key: 'contactId', kind: 'contact' },
    { key: 'dealId', kind: 'deal' },
  ]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  // v2 row awaiting its file: resubmit created the version row — the upload
  // dialog below completes it (upload-url → PUT → complete → submit).
  const [pendingVersionId, setPendingVersionId] = useState(null);

  async function doVerify() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/documents/${id}/verify`, { method: 'POST' });
      push('Document verified.', 'success');
      retry();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doResubmit() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api(`/documents/${id}/resubmit`, {
        method: 'POST',
        headers: { 'Idempotency-Key': resubmitKey },
      });
      const next = res.document ?? res;
      push(`Resubmitted as v${next.version ?? 'next'}. Upload the new file to complete it.`, 'success');
      // Open the file steps for the new version instead of stranding it.
      if (next.id) setPendingVersionId(next.id);
      retry();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Document" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !doc) {
    return (
      <PageShell>
        <PageHeader eyebrow="Document" title="Document not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  const actions = documentReviewActions(doc.status);

  return (
    <PageShell>
      <PageHeader
        eyebrow={`Document · v${doc.version}`}
        title={doc.type}
        description="Row-per-version history. File bytes live in private object storage; review never edits a finalized row."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/documents">← All documents</Link>
            <AccessButton documentId={id} />
            {actions.includes('verify') && (
              <PermissionGate resource="document" action="verify">
                <Button variant="primary" onClick={doVerify} disabled={busy}>Verify</Button>
              </PermissionGate>
            )}
            {actions.includes('reject') && (
              <PermissionGate resource="document" action="reject">
                <Button variant="destructive" onClick={() => setRejectOpen(true)} disabled={busy}>Reject</Button>
              </PermissionGate>
            )}
            {actions.includes('resubmit') && (
              <PermissionGate resource="document" action="upload">
                <Button variant="primary" onClick={doResubmit} disabled={busy}>Resubmit new version</Button>
              </PermissionGate>
            )}
          </>
        }
      />
      {actionError && <ErrorState message={actionError.message} details={actionError.details ? JSON.stringify(actionError.details) : null} onRetry={retry} />}
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Status"><StatusBadge status={doc.status} /></Row>
            <Row label="Type">{doc.type}</Row>
            <Row label="Contact"><RelatedName kind="contact" id={doc.contactId} maps={maps} /></Row>
            <Row label="Deal">
              {doc.dealId ? <RelatedName kind="deal" id={doc.dealId} maps={maps} /> : <span className="muted">—</span>}
            </Row>
            <Row label="Version">v{doc.version}{doc.supersedesId ? <span className="muted"> (supersedes <span title={doc.supersedesId}>{shortId(doc.supersedesId)}</span>)</span> : ''}</Row>
            {doc.status === 'REJECTED' && <Row label="Rejection reason">{doc.rejectionReason || '—'}</Row>}
            {(doc.reviewedBy || doc.reviewedAt) && (
              <>
                <Row label="Reviewed by"><span title={doc.reviewedBy}>{shortId(doc.reviewedBy)}</span></Row>
                <Row label="Reviewed at">{formatDateTime(doc.reviewedAt)}</Row>
              </>
            )}
            <Row label="Created">{formatDateTime(doc.createdAt)}</Row>
            <Row label="Updated">{formatDateTime(doc.updatedAt)}</Row>
          </dl>
        </Card>
        <Card title="Version history">
          <VersionHistory groupId={doc.groupId} currentId={doc.id} />
        </Card>
      </div>
      <RejectDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        documentId={id}
        onDone={() => { retry(); push('Document rejected with reason.', 'success'); }}
      />
      {pendingVersionId && (
        <UploadDialog
          documentId={pendingVersionId}
          onClose={() => { setPendingVersionId(null); retry(); }}
          onDone={() => { setPendingVersionId(null); retry(); }}
        />
      )}
    </PageShell>
  );
}

function VersionHistory({ groupId, currentId }) {
  const { data, error, loading, retry } = useApi(`/documents?groupId=${groupId}&limit=100&offset=0`);
  const rows = (data ?? []).slice().sort((a, b) => b.version - a.version);
  if (loading) return <Skeleton lines={3} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (rows.length === 0) return <EmptyState title="No versions" message="History will appear here." />;
  return (
    <Table
      columns={[
        { key: 'version', label: 'Version', render: (r) => <span>v{r.version}{r.id === currentId ? ' · current' : ''}</span> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        {
          key: 'id', label: 'Record', render: (r) => (r.id === currentId
            ? <span className="muted">this record</span>
            : <EntityLink to={`/app/documents/${r.id}`}>Open</EntityLink>),
        },
        { key: 'updatedAt', label: 'Updated', render: (r) => formatDateTime(r.updatedAt) },
      ]}
      rows={rows}
      rowKey={(r) => r.id}
    />
  );
}
