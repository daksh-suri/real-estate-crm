import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dialog idempotency-key contracts (hardening pass): submit keys must come
// from the stable per-mount useIdempotencyKey hook — never a fresh
// crypto.randomUUID() per submit, which would fork duplicate backend effects
// on timeout retry instead of replaying. The repo has no component renderer
// in devDependencies, so these are source contracts like CommunicationPage.
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');

function src(...parts) {
  return readFileSync(join(clientSrc, ...parts), 'utf8');
}

function expectStableKey(source, file) {
  expect(source, `${file} imports the stable hook`).toContain('useIdempotencyKey');
  expect(source, `${file} calls the hook once per mount`).toMatch(/const \w+ = useIdempotencyKey\(\)/);
  expect(source, `${file} sends the stable key`).toMatch(/'Idempotency-Key': \w+/);
  expect(source, `${file} mints no per-submit UUID`).not.toContain('crypto.randomUUID()');
}

describe('dialog idempotency-key contracts', () => {
  test('IntakeDialog uses the stable per-mount key', () => {
    expectStableKey(src('routes', 'enquiries', 'IntakeDialog.jsx'), 'IntakeDialog');
  });

  test('ScheduleDialog uses the stable per-mount key', () => {
    expectStableKey(src('routes', 'visits', 'ScheduleDialog.jsx'), 'ScheduleDialog');
  });

  test('CreateTaskDialog uses the stable per-mount key', () => {
    expectStableKey(src('routes', 'activities', 'TasksPage.jsx'), 'TasksPage');
  });

  test('useIdempotencyKey is stable across renders of one mount', () => {
    const hook = src('hooks', 'useIdempotencyKey.js');
    expect(hook).toContain('useRef');
    expect(hook).toContain('crypto.randomUUID()');
  });
});
