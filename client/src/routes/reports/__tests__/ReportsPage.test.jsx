import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRangeStart, toRangeEnd, rangeQuery } from '../ReportsPage';

// No component renderer in devDependencies (repo convention: pure unit +
// source-contract tests). Behavioral states are verified as contracts.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..', '..');
const repoRoot = resolve(clientSrc, '..', '..');
const pageSource = readFileSync(join(clientSrc, 'routes', 'reports', 'ReportsPage.jsx'), 'utf8');
const appSource = readFileSync(join(clientSrc, 'App.jsx'), 'utf8');

describe('date-range helpers (half-open [from, to), UTC)', () => {
  test('start is the same day at UTC midnight', () => {
    expect(toRangeStart('2026-09-20')).toBe('2026-09-20T00:00:00.000Z');
    expect(toRangeStart('')).toBe('');
  });

  test('end rolls to the next midnight so the end day stays inclusive', () => {
    expect(toRangeEnd('2026-09-20')).toBe('2026-09-21T00:00:00.000Z');
    expect(toRangeEnd('')).toBe('');
  });

  test('range query omits unset ends', () => {
    expect(rangeQuery('', '')).toBe('');
    expect(rangeQuery('2026-09-01', '')).toBe('?from=2026-09-01T00%3A00%3A00.000Z');
    expect(rangeQuery('', '2026-09-20')).toBe('?to=2026-09-21T00%3A00%3A00.000Z');
  });
});

describe('fetch contracts', () => {
  const endpoints = [
    'deals', 'leads', 'visits', 'bookings', 'payments',
    'tasks', 'activities', 'inventory', 'documents', 'contacts',
  ];

  test('all ten report endpoints are fetched (no giant query-builder call)', () => {
    for (const e of endpoints) expect(pageSource).toContain(`/reports/${e}`);
  });

  test('date filters ride the existing URL-state pattern', () => {
    expect(pageSource).toContain("useUrlListState(['view', 'from', 'to'])");
  });

  test('invalid ranges block fetching with an inline error', () => {
    expect(pageSource).toContain('rangeInvalid');
    expect(pageSource).toContain('must not be after the end day');
  });

  test('only the active tab fetches (no duplicate requests)', () => {
    expect(pageSource).toContain("enabled: tab === 'pipeline'");
    expect(pageSource).toContain("enabled: tab === 'operations'");
    expect(pageSource).toContain("enabled: tab === 'money'");
  });
});

describe('reuse of existing architecture', () => {
  test('page composes existing primitives only', () => {
    for (const name of ['PageShell', 'PageHeader', 'StatTile', 'FilterBar', 'Tabs', 'Card', 'Skeleton', 'EmptyState', 'ErrorState']) {
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

describe('no fake/demo data, route live', () => {
  test('page contains no fabricated metrics', () => {
    for (const word of ['MOCK', 'mock data', 'demo-', 'lorem', 'Math.random']) {
      expect(pageSource).not.toContain(word);
    }
  });

  test('route replaced the placeholder', () => {
    expect(appSource).toContain("from './routes/reports/ReportsPage'");
    expect(appSource).toContain('<Route path="reports" element={<ReportsPage />} />');
    expect(appSource).not.toContain("'/app/reports'");
  });
});
