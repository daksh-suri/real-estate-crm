import { describe, test, expect } from 'vitest';
import { buildRelatedRequests, KINDS } from '../RelatedName';

// Regression for the /undefined/:id bug: callers pass { key, kind } and the
// endpoint must ALWAYS resolve through KINDS[kind], never from the caller.
describe('buildRelatedRequests', () => {
  const rows = [
    { contactId: 'c1', projectId: 'p1', leadSourceId: 's1', campaignId: 'm1' },
    { contactId: 'c1', projectId: 'p2', leadSourceId: null, campaignId: 'm1' },
    { contactId: null, projectId: null, leadSourceId: null, campaignId: null },
  ];
  const fields = [
    { key: 'contactId', kind: 'contact' },
    { key: 'projectId', kind: 'project' },
    { key: 'leadSourceId', kind: 'leadSource' },
    { key: 'campaignId', kind: 'campaign' },
  ];

  test('kind translates to the KINDS endpoint — never /undefined/', () => {
    const reqs = buildRelatedRequests(rows, fields);
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) {
      expect(r.endpoint).toBeDefined();
      expect(`/${r.endpoint}/${r.id}`).not.toContain('/undefined/');
    }
    const byKey = Object.fromEntries(reqs.map((r) => [`${r.key}:${r.id}`, r.endpoint]));
    expect(byKey['contactId:c1']).toBe('contacts');
    expect(byKey['projectId:p1']).toBe('projects');
    expect(byKey['projectId:p2']).toBe('projects');
    expect(byKey['leadSourceId:s1']).toBe('lead-sources');
    expect(byKey['campaignId:m1']).toBe('campaigns');
  });

  test('duplicate ids dedupe to one request each', () => {
    const reqs = buildRelatedRequests(rows, fields);
    const keys = reqs.map((r) => `${r.endpoint}:${r.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    // c1 appears twice, m1 appears twice → single entries.
    expect(reqs.filter((r) => r.id === 'c1')).toHaveLength(1);
    expect(reqs.filter((r) => r.id === 'm1')).toHaveLength(1);
  });

  test('unknown kinds and empty ids drop silently', () => {
    const reqs = buildRelatedRequests([{ contactId: 'c9', nope: 'x' }], [
      { key: 'contactId', kind: 'contact' },
      { key: 'nope', kind: 'noSuchKind' },
      { key: 'missing', kind: 'contact' },
    ]);
    expect(reqs).toEqual([{ key: 'contactId', endpoint: 'contacts', id: 'c9' }]);
    expect(buildRelatedRequests(null, fields)).toEqual([]);
    expect(buildRelatedRequests(rows, null)).toEqual([]);
  });
});

describe('KINDS label mapping (all supported kinds)', () => {
  test('each kind renders its human-readable name', () => {
    expect(KINDS.contact.label({ name: 'Asha' })).toBe('Asha');
    expect(KINDS.project.label({ name: 'Palm Meadows' })).toBe('Palm Meadows');
    expect(KINDS.leadSource.label({ name: 'PortalX' })).toBe('PortalX');
    expect(KINDS.campaign.label({ name: 'Diwali' })).toBe('Diwali');
    expect(KINDS.lead.label({ id: '12345678-abcd' })).toBe('Lead 12345678');
    expect(KINDS.deal.label({ id: '12345678-abcd' })).toBe('Deal 12345678');
    expect(KINDS.enquiry.label({ id: '12345678-abcd' })).toBe('Enquiry 12345678');
    expect(KINDS.user.endpoint).toBe('users'); // Checkpoint 18 directory
    expect(KINDS.user.label({ name: 'Asha' })).toBe('Asha');
    expect(KINDS.user.route('any-id')).toBeNull(); // no user detail page — plain name
  });

  test('user ids resolve through the directory endpoint', () => {
    const reqs = buildRelatedRequests([{ assignedTo: 'u1' }], [{ key: 'assignedTo', kind: 'user' }]);
    expect(reqs).toEqual([{ key: 'assignedTo', endpoint: 'users', id: 'u1' }]);
  });
});
