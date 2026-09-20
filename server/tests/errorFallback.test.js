// Central Prisma error fallback (hardening pass): raw P2002/P2025 must map to
// 409/404 instead of leaking through as 500. Service-level handlers keep
// precedence (explicit status/statusCode wins). No DB needed.
const errorHandler = require('../src/middleware/errorHandler');

function run(err) {
  const res = {
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  errorHandler(err, {}, res, () => {});
  return res;
}

describe('errorHandler Prisma fallback', () => {
  test('raw P2002 maps to 409 without DB detail', () => {
    const err = new Error('Unique constraint failed on the fields: (`tokenHash`)');
    err.code = 'P2002';
    const res = run(err);
    expect(res.code).toBe(409);
    expect(res.body).toEqual({ error: { message: err.message, status: 409, stack: expect.any(String) } });
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|meta|clientVersion/i);
  });

  test('raw P2025 maps to 404', () => {
    const err = new Error('Record not found for update (tenant x)');
    err.code = 'P2025';
    const res = run(err);
    expect(res.code).toBe(404);
    expect(res.body.error.status).toBe(404);
  });

  test('explicit service status keeps precedence over Prisma code', () => {
    const conflict = new Error('business conflict');
    conflict.statusCode = 409;
    conflict.code = 'P2002';
    expect(run(conflict).code).toBe(409);

    const badRequest = new Error('business rule');
    badRequest.statusCode = 400;
    badRequest.code = 'P2025';
    expect(run(badRequest).code).toBe(400);
  });

  test('unknown errors still map to 500', () => {
    const res = run(new Error('boom'));
    expect(res.code).toBe(500);
    expect(res.body.error).toMatchObject({ message: 'boom', status: 500 });
  });

  test('unmapped Prisma codes still map to 500, not crash', () => {
    const err = new Error('foreign key');
    err.code = 'P2003';
    expect(run(err).code).toBe(500);
  });
});
