import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { teamMemberName } from '../settings/TeamPage';

// Checkpoint 18 Settings contracts. Source contracts per repo convention (no
// component renderer in devDependencies) + pure-helper unit tests.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');

function src(...parts) {
  return readFileSync(join(clientSrc, ...parts), 'utf8');
}

function expectListPage(source, file) {
  expect(source, `${file} fetches via useApi`).toContain('useApi(');
  expect(source, `${file} paginates via useUrlListState`).toContain('useUrlListState(');
  expect(source, `${file} gates mutations`).toContain('PermissionGate');
  expect(source, `${file} confirms destructive actions`).toContain('ConfirmDialog');
  expect(source, `${file} refetches after mutation`).toContain('retry()');
  expect(source, `${file} toasts outcomes`).toContain('push(');
  expect(source, `${file} guards double submit`).toContain('if (pending) return;');
  expect(source, `${file} never gates on role names`).not.toMatch(/role\s*===\s*['"]Admin['"]/);
}

describe('settings list pages follow the established contract', () => {
  test('LeadSourcesPage', () => {
    const s = src('routes', 'settings', 'LeadSourcesPage.jsx');
    expectListPage(s, 'LeadSourcesPage');
    expect(s).toContain('/lead-sources');
  });

  test('CampaignsPage', () => {
    const s = src('routes', 'settings', 'CampaignsPage.jsx');
    expectListPage(s, 'CampaignsPage');
    expect(s).toContain('/campaigns');
  });

  test('AssignmentRulesPage', () => {
    const s = src('routes', 'settings', 'AssignmentRulesPage.jsx');
    expect(s).toContain('useApi(');
    expect(s).toContain('PermissionGate');
    expect(s).toContain('ConfirmDialog');
    expect(s).toContain('retry()');
    expect(s).toContain('/assignment-rules');
    // V1 type discipline: no new rule types, backend owns the counter.
    expect(s).toContain('ROUND_ROBIN');
    expect(s).not.toContain('TERRITORY');
    expect(s).not.toContain('PROJECT_AFFINITY');
  });

  test('TeamPage', () => {
    const s = src('routes', 'settings', 'TeamPage.jsx');
    expect(s).toContain('useApi(');
    expect(s).toContain('/users');
    expect(s).toContain('/teams');
    expect(s).toContain('PermissionGate');
    expect(s).toContain('ConfirmDialog');
    expect(s).toContain('retry()');
    expect(s).toContain('push(');
    // Employee provisioning never exposes a hash, deactivation is deferred.
    expect(s).not.toContain('passwordHash');
    expect(s).not.toContain('deactivat');
  });

  test('RolesPage is read-only', () => {
    const s = src('routes', 'settings', 'RolesPage.jsx');
    expect(s).toContain('/roles');
    expect(s).toContain('/roles/permissions/catalogue');
    expect(s).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/);
  });

  test('Settings hub is deprecated — settings routes remain', () => {
    const app = src('App.jsx');
    // Settings is now a navigation parent, not a page — /app/settings redirects to team
    expect(app).toContain('settings/team');
    expect(app).toContain('AssignmentRulesPage');
  });
});

describe('settings routing and nav', () => {
  test('App mounts real settings routes, no placeholders', () => {
    const app = src('App.jsx');
    for (const el of ['TeamPage', 'RolesPage', 'LeadSourcesPage', 'CampaignsPage', 'AssignmentRulesPage', 'CalendarPage']) {
      expect(app).toContain(el);
    }
    expect(app).toContain('Navigate to="settings/team"');
    expect(app).not.toContain('/app/settings/team\', \'Admin screens');
    expect(app).not.toContain('PlaceholderPage eyebrow={eyebrow}');
  });

  test('navConfig lists visible settings children and hides Assignment Rules', () => {
    const nav = src('routes', 'navConfig.js');
    for (const p of ['/app/settings/team', '/app/settings/roles-permissions', '/app/settings/lead-sources', '/app/settings/campaigns']) {
      expect(nav).toContain(p);
    }
    expect(nav).not.toContain('/app/settings/assignment-rules');
    // Settings is now a parent label (children) under Admin, not a standalone /app/settings route
    expect(nav).toContain('children');
    expect(nav).toContain('/app/calendar');
  });
});

describe('teamMemberName', () => {
  test('prefers the member name', () => {
    expect(teamMemberName({ user: { id: 'u1', name: 'Asha' } })).toBe('Asha');
  });

  test('falls back to short id', () => {
    expect(teamMemberName({ user: { id: '12345678-abcd' } })).toBe('12345678');
  });
});
