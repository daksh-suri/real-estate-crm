import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  directionOf,
  channelMatches,
  timelinePath,
  contactSearchPath,
} from '../CommunicationPage';

// Communication V1 is a history view over Activity. The repo has no
// component renderer in devDependencies, so behavioral states are verified
// here as source contracts (exact fetch gating, no writes, no fake data)
// plus unit tests of the pure convention helpers.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');
const repoRoot = resolve(clientSrc, '..', '..');
const pageSource = readFileSync(join(clientSrc, 'routes', 'CommunicationPage.jsx'), 'utf8');
const appSource = readFileSync(join(clientSrc, 'App.jsx'), 'utf8');

describe('directionOf (outcome-prefix only)', () => {
  test('INBOUND_ prefix → inbound (case-insensitive, trimmed)', () => {
    expect(directionOf({ type: 'CALL', outcome: 'INBOUND_CONNECTED' })).toBe('inbound');
    expect(directionOf({ outcome: '  inbound_no_answer ' })).toBe('inbound');
  });

  test('OUTBOUND_ prefix → outbound', () => {
    expect(directionOf({ type: 'WHATSAPP', outcome: 'OUTBOUND_SENT' })).toBe('outbound');
  });

  test('type alone never implies direction', () => {
    expect(directionOf({ type: 'CALL' })).toBe(null);
    expect(directionOf({ type: 'CALL', outcome: null })).toBe(null);
    expect(directionOf({ type: 'MISSED_CALL', outcome: 'MISSED' })).toBe(null);
  });

  test('ambiguous or missing values stay neutral', () => {
    expect(directionOf({ outcome: 'CONNECTED' })).toBe(null);
    expect(directionOf({ outcome: 'RE_INBOUND' })).toBe(null);
    expect(directionOf({})).toBe(null);
    expect(directionOf()).toBe(null);
    expect(directionOf({ outcome: 42 })).toBe(null);
  });
});

describe('channelMatches (client-side page filter)', () => {
  test('empty filter matches everything', () => {
    expect(channelMatches({ type: 'CALL' }, '')).toBe(true);
    expect(channelMatches({ type: 'CALL' }, null)).toBe(true);
  });

  test('case-insensitive contains on type', () => {
    expect(channelMatches({ type: 'SITE_VISIT' }, 'call')).toBe(false);
    expect(channelMatches({ type: 'CALL' }, 'call')).toBe(true);
    expect(channelMatches({ type: 'WHATSAPP' }, 'whats')).toBe(true);
  });
});

describe('fetch contracts', () => {
  test('timeline URL carries contactId + limit/offset', () => {
    expect(timelinePath('c-1', 20, 40)).toBe('/activities?contactId=c-1&limit=20&offset=40');
  });

  test('contact search URL carries trimmed search + first page', () => {
    expect(contactSearchPath('  mee ')).toBe('/contacts?limit=20&offset=0&search=mee');
    expect(contactSearchPath('')).toBe('/contacts?limit=20&offset=0');
  });

  test('timeline and contact fetches are gated on a selected contact', () => {
    expect(pageSource).toContain('enabled: Boolean(contactId)');
  });

  test('picker fetches only while searching and unselected', () => {
    expect(pageSource).toContain("enabled: !contactId && search.trim() !== ''");
  });

  test('pagination keeps the bare-array contract (unfiltered length)', () => {
    expect(pageSource).toContain('(activities || []).length === limit');
    expect(pageSource).not.toMatch(/total|pages/);
  });
});

describe('reuse of existing architecture (no duplicate implementations)', () => {
  test('logging reuses LogActivityDialog with the selected contact prefilled', () => {
    expect(pageSource).toContain("from './activities/LogActivityDialog'");
    expect(pageSource).toContain('<LogActivityButton contactId={contactId}');
  });

  test('page performs no writes itself (no POST, no idempotency key, no followUpTask)', () => {
    expect(pageSource).not.toContain('Idempotency-Key');
    expect(pageSource).not.toContain('followUpTask');
    expect(pageSource).not.toMatch(/method:\s*['"]POST['"]/);
  });

  test('related records reuse RelatedName (bounded batching, no N+1)', () => {
    expect(pageSource).toContain("from '../components/crm/RelatedName'");
    expect(pageSource).toContain('useRelatedNames');
  });

  test('tasks are linked, never embedded or completed', () => {
    expect(pageSource).toContain('to="/app/tasks"');
    expect(pageSource).not.toContain('/complete');
  });
});

describe('no fake/demo data, no parallel model', () => {
  const forbidden = ['MOCK', 'mock data', 'demo-', 'lorem', 'placeholder conversation'];

  test('page contains no fake communication data', () => {
    for (const word of forbidden) expect(pageSource).not.toContain(word);
  });

  test('route is live (no Communication placeholder left)', () => {
    expect(appSource).toContain("from './routes/CommunicationPage'");
    expect(appSource).toContain('<Route path="communication" element={<CommunicationPage />} />');
    expect(appSource).not.toContain("'/app/communication'");
  });

  test('no Communication Prisma model or migration was introduced', () => {
    const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model\s+Communication\b/);
    expect(existsSync(join(repoRoot, 'server', 'src', 'modules', 'communication'))).toBe(false);
    const migrations = readdirSync(join(repoRoot, 'prisma', 'migrations'));
    expect(migrations.filter((m) => m.toLowerCase().includes('communicat'))).toEqual([]);
  });
});
