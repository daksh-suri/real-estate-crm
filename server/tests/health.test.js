const request = require('supertest');
const app = require('../src/app');

describe('Health Check Integration Test', () => {
  it('GET /health returns 200 with status ok and uptime', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('service', 'real-estate-crm-api');
    expect(typeof response.body.uptime).toBe('number');
  });

  it('GET /non-existent-route returns 404 with structured error', async () => {
    const response = await request(app).get('/non-existent-route');

    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error.status).toBe(404);
  });
});
