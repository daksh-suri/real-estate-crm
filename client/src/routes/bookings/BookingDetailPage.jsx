import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card } from '../../components/ui/controls';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { EntityLink, StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import PermissionGate from '../../permissions/permissions';
import { useToast } from '../../components/ui/Toast';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, shortId } from '../../lib/format';
import { CancelBookingDialog } from './BookingDialog';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function isBookingCancelled(booking) {
  return !!booking?.cancelledAt;
}

export default function BookingDetailPage() {
  const { id } = useParams();
  const { push } = useToast();
  const { data: booking, error, loading, retry } = useApi(`/bookings/${id}`);
  const maps = useRelatedNames(booking ? [booking] : null, [
    { key: 'unitId', kind: 'unit' },
    { key: 'dealId', kind: 'deal' },
    { key: 'reservationId', kind: 'reservation' },
  ]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelled = isBookingCancelled(booking);

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Booking" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !booking) {
    return (
      <PageShell>
        <PageHeader eyebrow="Booking" title="Booking not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Booking"
        title={`Booking ${shortId(booking.id)}`}
        description={cancelled ? 'Cancelled — preserved history.' : 'Recorded sale. The reservation behind it stays converted.'}
        actions={
          <>
            <Link className="btn btn--secondary btn--md" to="/app/bookings">← All bookings</Link>
            {!cancelled && (
              <>
                <PermissionGate resource="paymentPlan" action="create">
                  <Link className="btn btn--primary btn--md" to={`/app/payments?dealId=${booking.dealId}&planFor=${booking.id}`}>Create payment plan</Link>
                </PermissionGate>
                <PermissionGate resource="booking" action="cancel">
                  <Button variant="destructive" onClick={() => setCancelOpen(true)}>Cancel booking</Button>
                </PermissionGate>
              </>
            )}
          </>
        }
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="State">
              {cancelled ? <StatusBadge status="CANCELLED" /> : <StatusBadge status="BOOKED" />}
            </Row>
            <Row label="Unit"><RelatedName kind="unit" id={booking.unitId} maps={maps} /></Row>
            <Row label="Deal"><RelatedName kind="deal" id={booking.dealId} maps={maps} /></Row>
            <Row label="Reservation"><RelatedName kind="reservation" id={booking.reservationId} maps={maps} /></Row>
            <Row label="Booked">{formatDateTime(booking.bookedAt)}</Row>
            {cancelled && (
              <>
                <Row label="Cancelled by"><span title={booking.cancelledBy}>{shortId(booking.cancelledBy)}</span></Row>
                <Row label="Reason">{booking.cancellationReason || '—'}</Row>
                <Row label="Cancelled at">{formatDateTime(booking.cancelledAt)}</Row>
              </>
            )}
            <Row label="Created">{formatDateTime(booking.createdAt)}</Row>
          </dl>
        </Card>
        <Card title="Payment plan">
          <BookingPlan booking={booking} />
        </Card>
      </div>
      <CancelBookingDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        bookingId={id}
        onDone={() => { retry(); push('Booking cancelled; history preserved.', 'success'); }}
      />
    </PageShell>
  );
}

function BookingPlan({ booking }) {
  const { data, error, loading, retry } = useApi(`/payment-plans?dealId=${booking.dealId}&limit=5&offset=0`);
  const rows = data ?? null;
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  if (!rows || rows.length === 0) {
    return (
      <p className="muted">
        No payment plan for this deal yet.{' '}
        <EntityLink to={`/app/payments?dealId=${booking.dealId}&planFor=${booking.id}`}>Create one</EntityLink>.
      </p>
    );
  }
  return (
    <p>
      Plan exists → <EntityLink to={`/app/payments/${rows[0].id}`}>Open payment plan</EntityLink>
    </p>
  );
}
