import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Badge, Card } from '../../components/ui/controls';
import { ErrorState, Skeleton } from '../../components/ui/data';
import { EntityLink } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function EnquiryDetailPage() {
  const { id } = useParams();
  const { data: row, error, loading, retry } = useApi(`/enquiries/${id}`);
  const maps = useRelatedNames(row ? [row] : null, [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'leadSourceId', kind: 'leadSource' },
    { key: 'campaignId', kind: 'campaign' },
    { key: 'linkedLeadId', kind: 'lead' },
  ]);

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Enquiry" title="Loading…" />
        <Skeleton lines={6} />
      </PageShell>
    );
  }
  if (error || !row) {
    return (
      <PageShell>
        <PageHeader eyebrow="Enquiry" title="Enquiry not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  const payloadKeys = row.rawPayload && typeof row.rawPayload === 'object' ? Object.keys(row.rawPayload) : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Enquiry"
        title={`Received ${formatDateTime(row.createdAt)}`}
        description={row.contactId ? 'Matched intake event.' : 'Unmatched intake event — preserved for review.'}
        actions={
          <Link className="btn btn--secondary btn--md" to="/app/enquiries">
            ← All enquiries
          </Link>
        }
      />
      <Card title="Intake record">
        <dl className="detail-list">
          <Row label="Channel">
            <Badge tone="info">{row.channel}</Badge>
          </Row>
          <Row label="Contact">
            <RelatedName kind="contact" id={row.contactId} maps={maps} />
          </Row>
          <Row label="Project">
            <RelatedName kind="project" id={row.projectId} maps={maps} />
          </Row>
          <Row label="Source">
            <RelatedName kind="leadSource" id={row.leadSourceId} maps={maps} />
          </Row>
          <Row label="Campaign">
            <RelatedName kind="campaign" id={row.campaignId} maps={maps} />
          </Row>
          <Row label="Linked lead">
            {row.linkedLeadId ? (
              <EntityLink to={`/app/leads/${row.linkedLeadId}`}>Open linked lead</EntityLink>
            ) : (
              <span className="muted">None — {row.contactId ? 'no open lead captured this event' : 'unmatched, see review queue'}</span>
            )}
          </Row>
          <Row label="Received">{formatDateTime(row.createdAt)}</Row>
        </dl>
      </Card>
      <Card title="Channel payload">
        {payloadKeys.length === 0 ? (
          <p className="muted">No channel payload was captured with this event.</p>
        ) : (
          <>
            <p className="muted">Captured fields: {payloadKeys.join(', ')}</p>
            <details className="raw-disclosure">
              <summary>Technical view (raw payload)</summary>
              <pre className="raw-json">{JSON.stringify(row.rawPayload, null, 2)}</pre>
            </details>
          </>
        )}
      </Card>
    </PageShell>
  );
}
