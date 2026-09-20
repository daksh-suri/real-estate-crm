import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Button, Card } from '../../components/ui/controls';
import { EmptyState, ErrorState, Skeleton, Table } from '../../components/ui/data';
import { StatusBadge } from '../../components/crm/crm';
import { RelatedName, useRelatedNames } from '../../components/crm/RelatedName';
import { useApi } from '../../hooks/useApi';
import { formatDateTime, formatMoney, shortId } from '../../lib/format';

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function isObligationOverdue(ob) {
  return ob && ob.status === 'OVERDUE';
}

function ObligationRecords({ obligationId }) {
  const { data, error, loading, retry } = useApi(`/payment-obligations/${obligationId}`);
  if (loading) return <Skeleton lines={2} />;
  if (error) return <ErrorState message={error.message} onRetry={retry} />;
  const records = data?.records ?? [];
  if (records.length === 0) {
    return <p className="muted">No payment records yet — records arrive via the gateway webhook.</p>;
  }
  return (
    <div className="records-subtable">
      <Table
        columns={[
          { key: 'status', label: 'Outcome', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'amount', label: 'Amount', render: (r) => formatMoney(r.amount) },
          { key: 'gatewayReference', label: 'Gateway ref', render: (r) => r.gatewayReference || <span className="muted">—</span> },
          { key: 'correctsRecordId', label: 'Corrects', render: (r) => (r.correctsRecordId ? <span title={r.correctsRecordId}>{shortId(r.correctsRecordId)}</span> : <span className="muted">—</span>) },
          { key: 'createdAt', label: 'Recorded', render: (r) => formatDateTime(r.createdAt) },
        ]}
        rows={records}
        rowKey={(r) => r.id}
      />
    </div>
  );
}

function ObligationRow({ ob }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr>
        <td>{formatMoney(ob.dueAmount)}</td>
        <td>{formatDateTime(ob.dueDate)}</td>
        <td><StatusBadge status={ob.status} /></td>
        <td>
          <Button variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? 'Hide records' : 'Show records'}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4}>
            <ObligationRecords obligationId={ob.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function PlanDetailPage() {
  const { id } = useParams();
  const { data: plan, error, loading, retry } = useApi(`/payment-plans/${id}`);
  const maps = useRelatedNames(plan ? [plan] : null, [{ key: 'dealId', kind: 'deal' }]);
  const obligations = plan?.obligations ?? [];
  const overdue = obligations.filter(isObligationOverdue).length;

  if (loading) {
    return (
      <PageShell>
        <PageHeader eyebrow="Payment plan" title="Loading…" />
        <Skeleton lines={5} />
      </PageShell>
    );
  }
  if (error || !plan) {
    return (
      <PageShell>
        <PageHeader eyebrow="Payment plan" title="Plan not found" />
        <ErrorState message={error?.message} onRetry={retry} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Payment plan"
        title={`Plan ${shortId(plan.id)}`}
        description={overdue > 0 ? `${overdue} overdue obligation${overdue === 1 ? '' : 's'} — derived at read, never stored.` : 'All obligations current.'}
        actions={<Link className="btn btn--secondary btn--md" to="/app/payments">← All plans</Link>}
      />
      <div className="section-stack">
        <Card title="Overview">
          <dl className="detail-list">
            <Row label="Deal"><RelatedName kind="deal" id={plan.dealId} maps={maps} /></Row>
            <Row label="Obligations">{obligations.length}</Row>
            <Row label="Created">{formatDateTime(plan.createdAt)}</Row>
          </dl>
        </Card>
        <Card title="Schedule">
          {obligations.length === 0 ? (
            <EmptyState title="No obligations" message="This plan carries no schedule rows." />
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Amount</th>
                    <th scope="col">Due</th>
                    <th scope="col">Status</th>
                    <th scope="col">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {obligations.map((ob) => (
                    <ObligationRow key={ob.id} ob={ob} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
