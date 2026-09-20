import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card } from '../../components/ui/controls';
import { ConfirmDialog } from '../../components/ui/overlays';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, shortId } from '../../lib/format';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function canConvertReservation(row) {
  return row && row.status === 'ACTIVE' && row.type === 'RESERVATION';
}

export default function ReservationDetailPage() {
  const { id } = useParams();
  const { api } = useAuth();
  const { push } = useToast();
  const { data: row, error, loading, retry } = useApi(`/reservations/${id}`);
  const maps = useRelatedNames(row ? [row] : null, [
    { key: 'unitId', kind: 'unit' },
    { key: 'dealId', kind: 'deal' },
  ]);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onRelease() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/reservations/${id}/release`, { method: 'POST' });
      push('Reservation released; unit returned to availability.', 'success');
      setReleaseOpen(false);
      retry();
    } catch (err) {
      push(err.message || 'Release failed.', 'error');
      setBusy(false);
      setReleaseOpen(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Reservation" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !row) {
    return (
      <PageShell>
        <PageHeader eyebrow="Reservation" title="Reservation not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={row.type === 'HOLD' ? 'Hold' : 'Reservation'}
        title={`${row.type === 'HOLD' ? 'Hold' : 'Reservation'} ${shortId(row.id)}`}
        description="Status is backend-driven. Expiry runs on the server; release and booking move through dedicated operations."
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/reservations">← All reservations</Link>
            {canConvertReservation(row) && (
              <PermissionGate resource="booking" action="create">
                <Link className="btn btn--primary btn--md" to={`/app/bookings?convert=${row.id}`}>Convert to booking</Link>
              </PermissionGate>
            )}
            {row.status === 'ACTIVE' && (
              <PermissionGate resource="reservation" action="release">
                <Button variant="destructive" onClick={() => setReleaseOpen(true)}>Release</Button>
              </PermissionGate>
            )}
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Type"><StatusBadge status={row.type} /></Row>
            <Row label="Status"><StatusBadge status={row.status} /></Row>
            <Row label="Unit"><RelatedName kind="unit" id={row.unitId} maps={maps} /></Row>
            <Row label="Deal"><RelatedName kind="deal" id={row.dealId} maps={maps} /></Row>
            <Row label="Expires">{row.expiresAt ? formatDateTime(row.expiresAt) : 'No expiry (management hold)'}</Row>
            <Row label="Created">{formatDateTime(row.createdAt)}</Row>
            <Row label="Updated">{formatDateTime(row.updatedAt)}</Row>
          </dl>
        </Card>
        <Card title="Booking">
          <ReservationBooking reservationId={id} />
        </Card>
      </div>
      <ConfirmDialog
        open={releaseOpen}
        title={row.type === 'HOLD' ? 'Release hold' : 'Release reservation'}
        message="The claim becomes RELEASED and the unit returns to AVAILABLE where backend rules permit. This cannot be undone — a new claim needs a fresh reservation."
        confirmLabel={busy ? 'Releasing…' : 'Release'}
        onClose={() => { if (!busy) setReleaseOpen(false); }}
        onConfirm={onRelease}
      />
    </PageShell>
  );
}

function ReservationBooking({ reservationId }) {
  const { data, error, loading, retry } = useApi(`/bookings?reservationId=${reservationId}&limit=5&offset=0`);
  const rows = data ?? null;
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (!rows || rows.length === 0) {
    return <p className="muted">Not converted — no booking references this reservation.</p>;
  }
  return (
    <p>
      Converted → <EntityLink to={`/app/bookings/${rows[0].id}`}>Open booking</EntityLink>
    </p>
  );
}
