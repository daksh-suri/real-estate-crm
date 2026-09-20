import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No component renderer in devDependencies (repo convention: pure unit +
// source-contract tests). Behavioral states are verified as contracts.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..', '..');
const repoRoot = resolve(clientSrc, '..', '..');
const pageSource = readFileSync(join(clientSrc, 'routes', 'dashboard', 'DashboardPage.jsx'), 'utf8');
const appSource = readFileSync(join(clientSrc, 'App.jsx'), 'utf8');
const cssSource = readFileSync(join(clientSrc, 'routes', 'dashboard', 'dashboard.css'), 'utf8');

describe('DashboardPage fetch contracts', () => {
  test('single useApi call to /dashboard', () => {
    const matches = pageSource.match(/useApi\(['"`]\/dashboard['"`]/g);
    expect(matches).toHaveLength(1);
  });

  test('no other useApi fetches (no independent domain requests)', () => {
    // Only the one /dashboard call should exist
    const allFetches = pageSource.match(/useApi\(/g);
    expect(allFetches).toHaveLength(1);
  });

  test('no tab/filter state that could cause duplicate requests', () => {
    expect(pageSource).not.toContain('useState');
    // Dashboard has no tabs (unlike Reports) — it is a single-view page
  });
});

describe('DashboardPage reuses existing architecture', () => {
  test('composes existing primitives only', () => {
    for (const name of ['PageShell', 'PageHeader', 'StatTile', 'Card', 'Table', 'StatusBadge', 'Skeleton', 'EmptyState', 'ErrorState', 'EntityLink', 'RelatedName', 'useRelatedNames']) {
      expect(pageSource).toContain(name);
    }
  });

  test('no chart dependency or canvas/svg charting', () => {
    expect(pageSource).not.toMatch(/recharts|chart\.js|\bd3\b|visx|victory|<canvas|<svg/);
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'client', 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((d) => /recharts|chart|d3|visx|victory|nivo/i.test(d))).toEqual([]);
  });
});

describe('no fake/demo data', () => {
  test('page contains no fabricated metrics', () => {
    for (const word of ['MOCK', 'mock data', 'demo-', 'lorem', 'Math.random']) {
      expect(pageSource).not.toContain(word);
    }
  });
});

describe('App.jsx route integration', () => {
  test('DashboardPage is imported', () => {
    expect(appSource).toContain("import DashboardPage from './routes/dashboard/DashboardPage'");
  });

  test('dashboard route uses DashboardPage (not PlaceholderPage)', () => {
    expect(appSource).toContain('path="dashboard" element={<DashboardPage />}');
    expect(appSource).not.toContain('path="dashboard" element={<PlaceholderPage');
  });
});

describe('navigation links point to real pages', () => {
  test('attention tiles link to existing routes', () => {
    expect(pageSource).toContain('"/app/tasks"');
    expect(pageSource).toContain('"/app/payments"');
    expect(pageSource).toContain('"/app/reservations"');
  });

  test('upcoming sections link to existing routes', () => {
    expect(pageSource).toContain('"/app/site-visits"');
    expect(pageSource).toContain('"/app/activities"');
  });
});

describe('KPI strip renders all six tiles', () => {
  test('six StatTile labels present', () => {
    const expected = ['Open Leads', 'Active Deals', 'Upcoming Visits', 'Active Reservations', 'Open Tasks', 'Overdue Tasks'];
    for (const label of expected) {
      expect(pageSource).toContain(`label="${label}"`);
    }
  });
});

describe('layout', () => {
  test('page header eyebrow is Work', () => {
    expect(pageSource).toContain('eyebrow="Work"');
  });

  test('CSS includes responsive two-column grid', () => {
    expect(cssSource).toContain('dashboard-two-col');
    expect(cssSource).toContain('@media');
  });
});

describe('no chart dependencies added', () => {
  test('no chart libraries in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'client', 'package.json'), 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const d of Object.keys(all)) {
      expect(d).not.toMatch(/recharts|chart|d3|visx|victory|nivo/i);
    }
  });
});
