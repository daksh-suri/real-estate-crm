// Object-storage boundary (Checkpoints 13/17E). Postgres holds metadata;
// file bytes live in private Cloudflare R2, reached only via short-lived
// server-signed URLs (see DEC-030). AWS SDK v3 against the R2 S3-compatible
// endpoint (region 'auto'). Path-style signing is pinned for determinism
// across SDK versions; it has NOT been verified against a live R2 bucket —
// do not change it on static assumptions, verify with a real bucket first
// (presigned PUT + PUT + HEAD + GET) if uploads ever misbehave.
// Credentials are server-only env, never leave the backend.
// Tests inject a fake via setStorageProvider (or run unconfigured → 503).
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// 15 minutes — presigned URLs are bearer tokens for sensitive documents.
const URL_TTL_SECONDS = 15 * 60;

let provider = null;
function setStorageProvider(p) {
  provider = p;
}

// Canonical R2 configuration. R2_* names only (clean break from the old
// STORAGE_* convention — those names are no longer read). The endpoint is
// derived from the account ID per Cloudflare's documented format.
function storageConfig() {
  const accountId = process.env.R2_ACCOUNT_ID || null;
  return {
    accountId,
    endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null,
    bucket: process.env.R2_BUCKET_NAME || null,
    region: 'auto',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || null,
  };
}

function isStorageConfigured(cfg = storageConfig()) {
  return Boolean(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

function notConfiguredError() {
  const err = new Error('Document storage is not configured');
  err.statusCode = 503;
  return err;
}

function r2Client(cfg) {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // Pinned path style: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>.
    // Deterministic across SDK versions (no virtual-hosted fallback) and the
    // canonical shape in Cloudflare's S3-client documentation.
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

// Server-derived key: tenant + contact + group + version. Never from client.
function storageKeyFor({ organizationId, contactId, groupId, version }) {
  return [organizationId, contactId, groupId, `v${version}`].join('/');
}

async function createUploadUrl({ storageKey, expiresSeconds = URL_TTL_SECONDS }) {
  if (provider) return provider.createUploadUrl({ storageKey, expiresSeconds });
  const cfg = storageConfig();
  if (!isStorageConfigured(cfg)) throw notConfiguredError();
  const url = await getSignedUrl(
    r2Client(cfg),
    new PutObjectCommand({ Bucket: cfg.bucket, Key: storageKey }),
    { expiresIn: expiresSeconds }
  );
  return { url, expiresInSeconds: expiresSeconds, storageKey };
}

async function createAccessUrl({ storageKey, expiresSeconds = URL_TTL_SECONDS }) {
  if (provider) return provider.createAccessUrl({ storageKey, expiresSeconds });
  const cfg = storageConfig();
  if (!isStorageConfigured(cfg)) throw notConfiguredError();
  const url = await getSignedUrl(
    r2Client(cfg),
    new GetObjectCommand({ Bucket: cfg.bucket, Key: storageKey }),
    { expiresIn: expiresSeconds }
  );
  return { url, expiresInSeconds: expiresSeconds, storageKey };
}

// Existence via HEAD: 404/NotFound/NoSuchKey means "missing" (false).
// Anything else — outage, auth, network — is infrastructure failure and
// throws, never silently converted into "file missing".
async function objectExists({ storageKey }) {
  if (provider) {
    if (typeof provider.objectExists !== 'function') {
      const err = new Error('Storage provider does not support existence checks');
      err.statusCode = 501;
      throw err;
    }
    return provider.objectExists({ storageKey });
  }
  const cfg = storageConfig();
  if (!isStorageConfigured(cfg)) throw notConfiguredError();
  try {
    await r2Client(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: storageKey }));
    return true;
  } catch (err) {
    if (err && (err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) {
      return false;
    }
    const wrapped = new Error(`Storage lookup failed: ${err && err.message ? err.message : String(err)}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }
}

module.exports = {
  URL_TTL_SECONDS,
  storageConfig,
  isStorageConfigured,
  storageKeyFor,
  createUploadUrl,
  createAccessUrl,
  objectExists,
  setStorageProvider,
};
