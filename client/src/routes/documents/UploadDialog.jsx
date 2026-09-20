import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/controls';
import { Dialog } from '../../components/ui/overlays';
import { ErrorState } from '../../components/ui/data';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useNavigate } from 'react-router-dom';

// UX-only guards (R2/the backend enforce nothing client-side): PDF/images,
// 10MB cap. The authoritative gates stay server-side (validation, grants,
// object-existence at complete).
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp';
const MAX_BYTES = 10 * 1024 * 1024;

export function acceptedTypesLabel() {
  return 'PDF or image (JPG/PNG/WebP), up to 10MB';
}

// Full agent upload flow in one dialog:
//   create metadata → upload-url → PUT bytes to R2 → complete → submit
// Metadata creation is NOT success: the dialog only reports completion after
// the server confirms the object exists. Each step surfaces its own errors.
export function UploadDocumentButton({ contactId, dealId, onDone }) {
  const [open, setOpen] = useState(false);
  return (
    <PermissionGate resource="document" action="create">
      <Button variant="primary" onClick={() => setOpen(true)}>Upload document</Button>
      {open && <UploadDialog contactId={contactId} dealId={dealId} onClose={() => setOpen(false)} onDone={onDone} />}
    </PermissionGate>
  );
}

export function UploadDialog({ contactId: presetContactId, dealId: presetDealId, documentId: presetDocumentId, onClose, onDone }) {
  const { api } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const createKey = useIdempotencyKey();
  const [contactId, setContactId] = useState(presetContactId ?? '');
  const [dealId, setDealId] = useState(presetDealId ?? '');
  const [type, setType] = useState('');
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('form'); // form | uploading | failed
  const [error, setError] = useState(null);

  function pickFile(e) {
    setError(null);
    const f = e.target.files && e.target.files[0];
    if (!f) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError(Object.assign(new Error(`Unsupported file type. ${acceptedTypesLabel()}.`), { statusCode: 400 }));
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(Object.assign(new Error(`File too large (${(f.size / 1048576).toFixed(1)}MB). ${acceptedTypesLabel()}.`), { statusCode: 400 }));
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function putToR2(url, f) {
    const res = await fetch(url, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
    if (!res.ok) {
      throw Object.assign(new Error(`Upload to storage failed (status ${res.status}). The document is not uploaded — retry.`), { statusCode: 502 });
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (phase === 'uploading' || !file) return;
    setPhase('uploading');
    setError(null);
    // Resubmit mode: the version row already exists (POST /:id/resubmit made
    // it) — skip metadata creation and run the file steps against it.
    const resubmitMode = !!presetDocumentId;
    let docId = presetDocumentId ?? null;
    try {
      if (!resubmitMode) {
        // 1. Metadata (idempotent).
        const created = await api('/documents', {
          method: 'POST',
          headers: { 'Idempotency-Key': createKey },
          body: {
            contactId: contactId.trim(),
            dealId: dealId.trim() === '' ? null : dealId.trim(),
            type: type.trim(),
          },
        });
        const doc = created.document ?? created;
        docId = doc.id;
      }
      // 2. Scoped upload URL (never the bytes through our server).
      const { url } = await api(`/documents/${docId}/upload-url`, { method: 'POST' });
      // 3. Bytes go directly to R2.
      await putToR2(url, file);
      // 4. Server confirms the object exists before SUBMITTED.
      await api(`/documents/${docId}/complete`, { method: 'POST' });
      // 5. Into review.
      await api(`/documents/${docId}/submit`, { method: 'POST' });
      push(resubmitMode ? 'New version uploaded and submitted for review.' : 'Document uploaded and submitted for review.', 'success');
      onDone?.({ id: docId });
      onClose();
      navigate(`/app/documents/${docId}`);
    } catch (err) {
      setError(err);
      setPhase('failed');
      if (docId && !resubmitMode) {
        // Best-effort pointer: the draft row (NOT_SUBMITTED) remains for
        // retry; nothing was marked uploaded.
        push('Upload did not complete — the draft is preserved for retry.', 'error');
      }
    }
  }

  return (
    <Dialog
      open
      title={presetDocumentId ? 'Upload new version' : 'Upload document'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={phase === 'uploading'}>Cancel</Button>
          <Button variant="primary" onClick={onSubmit} disabled={phase === 'uploading' || !file}>
            {phase === 'uploading' ? 'Uploading…' : phase === 'failed' ? 'Retry upload' : 'Upload & submit'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="form-grid">
        {presetDocumentId ? (
          <p className="form-field__hint">Uploading the new file for the resubmitted version. The server confirms the object before it enters review.</p>
        ) : (
          <>
            <Field label="Contact ID" hint="The document belongs to a contact.">
              <Input value={contactId} onChange={(e) => { setContactId(e.target.value); setError(null); }} placeholder="UUID" required />
            </Field>
            <Field label="Deal ID (optional)">
              <Input value={dealId} onChange={(e) => { setDealId(e.target.value); setError(null); }} placeholder="UUID" />
            </Field>
            <Field label="Document type" hint="Free-form label, e.g. ID_PROOF, ADDRESS_PROOF (max 50 chars).">
              <Input value={type} onChange={(e) => { setType(e.target.value); setError(null); }} required maxLength={50} />
            </Field>
          </>
        )}
        <Field label={`File — ${acceptedTypesLabel()}`}>
          <Input type="file" accept={ACCEPT_ATTR} onChange={pickFile} required={!file} />
        </Field>
        {error && <ErrorState message={error.message} details={error.details ? JSON.stringify(error.details) : null} />}
      </form>
    </Dialog>
  );
}
