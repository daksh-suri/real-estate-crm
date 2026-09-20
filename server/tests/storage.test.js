// Storage boundary unit tests (17E): R2 env resolution + failure semantics.
// No DB, no network, no credentials — the injected fake answers everything.
const {
  storageConfig,
  isStorageConfigured,
  createUploadUrl,
  createAccessUrl,
  objectExists,
  setStorageProvider,
} = require('../src/lib/storage');

const KEYS = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Legacy names must be ignored (R2-only clean break).
  delete process.env.STORAGE_ENDPOINT;
  delete process.env.STORAGE_BUCKET;
  delete process.env.STORAGE_ACCESS_KEY_ID;
  delete process.env.STORAGE_SECRET_ACCESS_KEY;
  setStorageProvider(null);
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setStorageProvider(null);
});

function configure() {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
}

describe('storage configuration (R2-only)', () => {
  test('unconfigured env resolves to not-configured', () => {
    const cfg = storageConfig();
    expect(cfg.endpoint).toBeNull();
    expect(isStorageConfigured(cfg)).toBe(false);
  });

  test('legacy STORAGE_* names are ignored', () => {
    process.env.STORAGE_ENDPOINT = 'https://legacy.example.com';
    process.env.STORAGE_BUCKET = 'legacy-bucket';
    process.env.STORAGE_ACCESS_KEY_ID = 'x';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'y';
    expect(isStorageConfigured()).toBe(false);
  });

  test('R2 vars resolve endpoint from the account id', () => {
    configure();
    const cfg = storageConfig();
    expect(cfg.endpoint).toBe('https://test-account.r2.cloudflarestorage.com');
    expect(cfg.bucket).toBe('test-bucket');
    expect(cfg.region).toBe('auto');
    expect(isStorageConfigured(cfg)).toBe(true);
  });

  test('partial R2 vars stay unconfigured', () => {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_BUCKET_NAME = 'test-bucket';
    expect(isStorageConfigured()).toBe(false);
  });

  test('unconfigured storage throws 503 on every operation', async () => {
    await expect(createUploadUrl({ storageKey: 'a/b' })).rejects.toMatchObject({ statusCode: 503 });
    await expect(createAccessUrl({ storageKey: 'a/b' })).rejects.toMatchObject({ statusCode: 503 });
    await expect(objectExists({ storageKey: 'a/b' })).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('injected provider boundary', () => {
  test('provider answers all three operations without env', async () => {
    setStorageProvider({
      createUploadUrl: ({ storageKey }) => ({ url: `https://fake/up/${storageKey}`, expiresInSeconds: 900, storageKey }),
      createAccessUrl: ({ storageKey }) => ({ url: `https://fake/down/${storageKey}`, expiresInSeconds: 900, storageKey }),
      objectExists: async () => true,
    });
    expect((await createUploadUrl({ storageKey: 'k' })).url).toContain('https://fake/up/');
    expect((await createAccessUrl({ storageKey: 'k' })).url).toContain('https://fake/down/');
    expect(await objectExists({ storageKey: 'k' })).toBe(true);
  });

  test('provider without objectExists fails closed with 501', async () => {
    setStorageProvider({ createUploadUrl: async () => ({}) });
    await expect(objectExists({ storageKey: 'k' })).rejects.toMatchObject({ statusCode: 501 });
  });
});
