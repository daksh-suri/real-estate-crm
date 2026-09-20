// Object-storage boundary (Checkpoint 13). Postgres holds metadata;
// file bytes live in S3-compatible storage, reached only via short-lived
// server-signed URLs. No SDK dependency: SigV4 query-auth presigning is
// stdlib crypto. Everything configurable via env; nothing hardcoded.
// Tests inject a fake via setStorageProvider (or run unconfigured → 503).
const crypto = require('crypto');

// 24h — inside the documented 24–48h window.
const URL_TTL_SECONDS = 24 * 60 * 60;

let provider = null;
function setStorageProvider(p) {
  provider = p;
}

function storageConfig() {
  return {
    endpoint: process.env.STORAGE_ENDPOINT || null,
    bucket: process.env.STORAGE_BUCKET || null,
    region: process.env.STORAGE_REGION || 'us-east-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || null,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || null,
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

// Server-derived key: tenant + contact + group + version. Never from client.
function storageKeyFor({ organizationId, contactId, groupId, version }) {
  return [organizationId, contactId, groupId, `v${version}`].join('/');
}

function encodeRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function amzDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function presignUrl({ method, storageKey, expiresSeconds, cfg }) {
  const host = new URL(cfg.endpoint).host;
  const canonicalUri = `/${cfg.bucket}/${storageKey.split('/').map(encodeRfc3986).join('/')}`;
  const now = new Date();
  const amzdate = amzDateTime(now);
  const datestamp = amzdate.slice(0, 8);
  const credential = `${cfg.accessKeyId}/${datestamp}/${cfg.region}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzdate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeRfc3986(params[k])}`)
    .join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${datestamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzdate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, datestamp), cfg.region), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  return `${cfg.endpoint.replace(/\/+$/, '')}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function createUploadUrl({ storageKey, expiresSeconds = URL_TTL_SECONDS }) {
  if (provider) return provider.createUploadUrl({ storageKey, expiresSeconds });
  const cfg = storageConfig();
  if (!isStorageConfigured(cfg)) throw notConfiguredError();
  return { url: presignUrl({ method: 'PUT', storageKey, expiresSeconds, cfg }), expiresInSeconds: expiresSeconds, storageKey };
}

function createAccessUrl({ storageKey, expiresSeconds = URL_TTL_SECONDS }) {
  if (provider) return provider.createAccessUrl({ storageKey, expiresSeconds });
  const cfg = storageConfig();
  if (!isStorageConfigured(cfg)) throw notConfiguredError();
  return { url: presignUrl({ method: 'GET', storageKey, expiresSeconds, cfg }), expiresInSeconds: expiresSeconds, storageKey };
}

module.exports = {
  URL_TTL_SECONDS,
  storageConfig,
  isStorageConfigured,
  storageKeyFor,
  createUploadUrl,
  createAccessUrl,
  setStorageProvider,
};
