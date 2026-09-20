// Rate-limit identity (hardening pass): keys must derive from Express req.ip
// only. X-Forwarded-For is client-spoofable and must not mint fresh buckets.
// `trust proxy` stays unset (direct single-instance topology).
const { loginKeyGenerator, uploadKeyGenerator } = require('../src/middleware/rateLimiter');

describe('rate limiter key generators', () => {
  test('login key ignores X-Forwarded-For', () => {
    const a = loginKeyGenerator({ ip: '10.0.0.1', body: { email: 'A@test.com' }, headers: {} });
    const spoofed = loginKeyGenerator({
      ip: '10.0.0.1',
      body: { email: 'A@test.com' },
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    expect(spoofed).toBe(a);
    expect(a).toBe('10.0.0.1:a@test.com');
  });

  test('login key still separates IPs and emails', () => {
    const base = { body: { email: 'a@test.com' }, headers: {} };
    expect(loginKeyGenerator({ ...base, ip: '10.0.0.1' })).not.toBe(
      loginKeyGenerator({ ...base, ip: '10.0.0.2' })
    );
    expect(loginKeyGenerator({ ip: '10.0.0.1', body: { email: 'a@test.com' }, headers: {} })).not.toBe(
      loginKeyGenerator({ ip: '10.0.0.1', body: { email: 'b@test.com' }, headers: {} })
    );
  });

  test('upload key ignores X-Forwarded-For', () => {
    const req = (ip, xff) => ({ ip, auth: { userId: 'u1' }, headers: xff ? { 'x-forwarded-for': xff } : {} });
    expect(uploadKeyGenerator(req('10.0.0.5', '9.9.9.9'))).toBe(uploadKeyGenerator(req('10.0.0.5', null)));
  });
});
