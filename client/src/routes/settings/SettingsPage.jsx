import PageShell, { PageHeader } from '../../components/layout/PageShell';
import { Card } from '../../components/ui/controls';
import { EntityLink } from '../../components/crm/crm';
import PermissionGate from '../../permissions/permissions';

const SECTIONS = [
  {
    to: '/app/settings/team',
    title: 'Team',
    text: 'Teams, members, and employee accounts in your organization.',
    resource: 'team',
    action: 'read',
  },
  {
    to: '/app/settings/roles-permissions',
    title: 'Roles & permissions',
    text: 'The current Role → Permission → Data Scope configuration. Read-only.',
    resource: 'role',
    action: 'read',
  },
  {
    to: '/app/settings/lead-sources',
    title: 'Lead sources',
    text: 'Where enquiries come from: portals, walk-in, referrals.',
    resource: 'leadSource',
    action: 'read',
  },
  {
    to: '/app/settings/campaigns',
    title: 'Campaigns',
    text: 'Marketing campaigns attached to lead sources.',
    resource: 'campaign',
    action: 'read',
  },
  {
    to: '/app/settings/assignment-rules',
    title: 'Assignment rules',
    text: 'How new leads are assigned. V1 supports round-robin only.',
    resource: 'assignmentRule',
    action: 'read',
  },
];

export default function SettingsPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Organization configuration. Every change is permission-gated and enforced by the backend."
      />
      <div className="section-stack">
        {SECTIONS.map((s) => (
          <PermissionGate key={s.to} resource={s.resource} action={s.action}>
            <Card title={s.title}>
              <p className="muted">{s.text}</p>
              <p>
                <EntityLink to={s.to}>Open {s.title.toLowerCase()} →</EntityLink>
              </p>
            </Card>
          </PermissionGate>
        ))}
      </div>
    </PageShell>
  );
}
