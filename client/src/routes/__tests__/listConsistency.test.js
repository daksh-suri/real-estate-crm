import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// List/routing consistency contracts (second hardening pass). Source
// contracts per repo convention (no component renderer in devDependencies).
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');

function src(...parts) {
  return readFileSync(join(clientSrc, ...parts), 'utf8');
}

describe('RelatedName project routing', () => {
  test('kind="project" links to the project detail route, not the list', () => {
    const related = src('components', 'crm', 'RelatedName.jsx');
    expect(related).toMatch(/project:\s*\{[^}]*route:\s*\(id\)\s*=>\s*`\/app\/properties\/projects\/\$\{id\}`/);
  });
});

describe('VisitsPage date filters', () => {
  test('date bounds are constructed as UTC midnight (Z suffix)', () => {
    const page = src('routes', 'visits', 'VisitsPage.jsx');
    expect(page).toContain('T00:00:00Z');
    expect(page).toContain('T23:59:59Z');
    expect(page).not.toMatch(/T00:00:00`\)/);
  });
});

describe('document review double-click guards', () => {
  test('doVerify and doResubmit bail out while busy', () => {
    const page = src('routes', 'documents', 'DocumentDetailPage.jsx');
    const verify = page.slice(page.indexOf('async function doVerify'), page.indexOf('async function doResubmit'));
    expect(verify).toContain('if (busy) return;');
    const resubmit = page.slice(page.indexOf('async function doResubmit'));
    expect(resubmit).toContain('if (busy) return;');
  });
});
