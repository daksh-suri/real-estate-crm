// Jest setupFiles entry: isolates the backend suite on its own database.
//
// The suite intentionally runs destructive cleanup (unfiltered deleteMany,
// including organizations), so it MUST NEVER run against the development
// database. This module runs in every test worker before any test file is
// imported (hence before Prisma clients are constructed):
//   1. If DATABASE_URL is unset, load it from the repo-root .env (local dev).
//      CI already injects DATABASE_URL explicitly — that value is respected.
//   2. Rewrite the URL's database to TEST_DATABASE_NAME, preserving
//      credentials/host/port/query. No secrets are invented or stored here.
//   3. Guard: refuse to continue unless the final database IS the test
//      database. Misconfiguration fails loudly instead of wiping dev data.
//
// Only the database NAME is ever logged — never the URL or credentials.
const path = require('path');

const TEST_DATABASE_NAME = 'real_estate_crm_test';

function loadFallbackEnv() {
  if (process.env.DATABASE_URL) return;
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

function toTestDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      '[tests/setup] DATABASE_URL is not a parseable Postgres URL, refusing to run. ' +
        'Set DATABASE_URL (or fix root .env) so the test database can be derived.'
    );
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      `[tests/setup] DATABASE_URL protocol "${url.protocol}" is not Postgres, refusing to run.`
    );
  }
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

function databaseNameOf(raw) {
  try {
    return new URL(raw).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

loadFallbackEnv();

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[tests/setup] DATABASE_URL is not set and no root .env provided one — refusing to run. ' +
      'Create the test database (see README) and ensure DATABASE_URL is configured.'
  );
}

process.env.DATABASE_URL = toTestDatabaseUrl(process.env.DATABASE_URL);

// Safety guard: destructive cleanup below must only ever hit the test DB.
if (databaseNameOf(process.env.DATABASE_URL) !== TEST_DATABASE_NAME) {
  throw new Error(
    `[tests/setup] Refusing to run: DATABASE_URL does not point at "${TEST_DATABASE_NAME}". ` +
      'Destructive test cleanup must never run against another database.'
  );
}

console.log(`[tests/setup] test database: "${TEST_DATABASE_NAME}" (credentials hidden)`);

module.exports = {};
