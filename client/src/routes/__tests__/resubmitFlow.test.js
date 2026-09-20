import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resubmit file-step contracts (hardening pass): POST /:id/resubmit creates
// the vN+1 row, and the UI must offer the file steps for it (upload-url →
// PUT → complete → submit) instead of stranding the version as a draft.
// Source contracts per repo convention (no component renderer in devDeps).
const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = resolve(here, '..', '..');

function src(...parts) {
  return readFileSync(join(clientSrc, ...parts), 'utf8');
}

describe('document resubmit file steps', () => {
  test('detail page opens the upload dialog for the resubmitted version', () => {
    const page = src('routes', 'documents', 'DocumentDetailPage.jsx');
    expect(page).toContain('setPendingVersionId');
    expect(page).toMatch(/<UploadDialog[\s\S]*documentId=\{pendingVersionId\}/);
  });

  test('upload dialog supports the resubmit version-row branch', () => {
    const dialog = src('routes', 'documents', 'UploadDialog.jsx');
    expect(dialog).toContain('presetDocumentId');
    // Skips metadata creation in resubmit mode, runs the file steps.
    expect(dialog).toMatch(/if \(!resubmitMode\)/);
    expect(dialog).toContain('/upload-url');
    expect(dialog).toContain('/complete');
    expect(dialog).toContain('/submit');
    // Metadata fields hidden when a version row already exists.
    expect(dialog).toMatch(/presetDocumentId \? \(/);
  });
});
