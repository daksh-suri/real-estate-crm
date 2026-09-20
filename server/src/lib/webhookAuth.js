// Provider-neutral webhook authentication (V1 generic boundary): hex
// HMAC-SHA256 over the exact raw request bytes, keyed by the server-side
// PAYMENT_WEBHOOK_SECRET. No provider-specific protocol — any caller that can
// HMAC the raw payload is accepted. Comparison is timing-safe; malformed
// signatures fail closed (false, never throw).
const crypto = require('crypto');

const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

function signWebhookPayload(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!rawBody || !signature || !secret) return false;
  const sig = String(signature).trim();
  if (!/^[0-9a-fA-F]+$/.test(sig) || sig.length !== 64) return false;
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(sig.toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { WEBHOOK_SIGNATURE_HEADER, signWebhookPayload, verifyWebhookSignature };
