// Production config fail-closed (hardening pass): prod must never silently
// run on dev/local defaults. Config is evaluated at require time, so each
// case re-requires it under a controlled NODE_ENV.
const CONFIG_PATH = '../src/config';

function loadConfigWith(env) {
  // Mutate env in place (never replace process.env wholesale) and restore
  // the same way. `undefined` values become '' so dotenv cannot repopulate
  // them from the root .env; every fail-closed check treats '' as missing.
  // NOTE: Jest uses its own module registry — require.cache surgery is a
  // no-op here; jest.resetModules() forces re-evaluation instead.
  const touched = {};
  for (const [k, v] of Object.entries(env)) {
    touched[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
    if (v === undefined) process.env[k] = '';
    else process.env[k] = v;
  }
  jest.resetModules();
  try {
    return require(CONFIG_PATH);
  } finally {
    for (const [k, v] of Object.entries(touched)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.resetModules();
  }
}

const PROD_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  CORS_ORIGIN: 'https://app.example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  PAYMENT_WEBHOOK_SECRET: 'b'.repeat(64),
};

describe('config fail-closed in production', () => {
  test('missing JWT secret throws', () => {
    expect(() => loadConfigWith({ ...PROD_BASE, JWT_ACCESS_SECRET: undefined })).toThrow(
      /JWT_ACCESS_SECRET/
    );
  });

  test('dev-default JWT secret throws even when explicitly provided', () => {
    expect(() =>
      loadConfigWith({ ...PROD_BASE, JWT_ACCESS_SECRET: 'dev-access-secret-change-in-production-32chars+' })
    ).toThrow(/dev default/);
  });

  test('short JWT secret throws', () => {
    expect(() => loadConfigWith({ ...PROD_BASE, JWT_ACCESS_SECRET: 'short-secret' })).toThrow(
      /at least 32 characters/
    );
  });

  test('missing CORS_ORIGIN throws', () => {
    expect(() => loadConfigWith({ ...PROD_BASE, CORS_ORIGIN: undefined })).toThrow(/CORS_ORIGIN/);
  });

  test('missing DATABASE_URL throws with a clear message', () => {
    expect(() => loadConfigWith({ ...PROD_BASE, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  test('missing PAYMENT_WEBHOOK_SECRET throws', () => {
    expect(() => loadConfigWith({ ...PROD_BASE, PAYMENT_WEBHOOK_SECRET: undefined })).toThrow(
      /PAYMENT_WEBHOOK_SECRET/
    );
  });

  test('valid production env loads', () => {
    const cfg = loadConfigWith({ ...PROD_BASE });
    expect(cfg.isProduction).toBe(true);
    expect(cfg.corsOrigin).toBe('https://app.example.com');
  });

  test('non-production keeps dev defaults (no throw)', () => {
    const cfg = loadConfigWith({ NODE_ENV: 'test' });
    expect(cfg.isProduction).toBe(false);
    expect(cfg.corsOrigin).toBe('http://localhost:5173');
  });
});
