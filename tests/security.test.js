const request = require('supertest');
const path = require('path');
const fs = require('fs');
const db = require('../src/config/db');

describe('Security Hardening Test Suite', () => {
  let app;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGIN = 'http://localhost:3000';
    if (process.env.DATABASE_URL) {
      try {
        await db.$connect();
      } catch (err) {
        console.warn('Test DB connection notice:', err.message);
      }
    }
    app = require('../src/server');
  }, 30000);

  afterAll(async () => {
    process.env.NODE_ENV = 'test';
    try {
      await db.$disconnect();
    } catch (_) {}
  });

  test('Req 7: CORS blocks unauthorized external origins', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://malicious-attacker-website.com');

    // Should either reject origin or omit Access-Control-Allow-Origin for untrusted domain
    expect(res.headers['access-control-allow-origin']).not.toBe('http://malicious-attacker-website.com');
  });

  test('Req 8: Helmet security headers are present in HTTP responses', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers).toHaveProperty('x-dns-prefetch-control');
    expect(res.headers).toHaveProperty('x-frame-options');
    expect(res.headers).toHaveProperty('x-content-type-options');
  });

  test('Req 1, 4, 16: API endpoints never expose session credentials or secrets', async () => {
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).not.toHaveProperty('sessionToken');
    expect(res.body.data).not.toHaveProperty('credentials');
    expect(res.body.data).not.toHaveProperty('databaseUrl');
  });

  test('Req 11: Uploading non-spreadsheet executable files is rejected', async () => {
    const fakeScriptPath = path.join(__dirname, 'malicious.exe');
    fs.writeFileSync(fakeScriptPath, 'malicious content');

    try {
      const res = await request(app)
        .post('/api/imports/upload')
        .attach('file', fakeScriptPath);

      expect([400, 415, 422, 500]).toContain(res.statusCode);
      expect(res.body.success).toBe(false);
    } finally {
      if (fs.existsSync(fakeScriptPath)) fs.unlinkSync(fakeScriptPath);
    }
  });

  test('Req 15, 17: Static uploads route forbids access to protected auth files & path traversal', async () => {
    const res = await request(app).get('/uploads/../.baileys_auth/creds.json');
    expect([403, 404]).toContain(res.statusCode);
  });

  test('Req 15: Error responses in production hide internal stack traces & filesystem paths', async () => {
    const res = await request(app).get('/api/contacts/invalid_mongo_id_format');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).not.toHaveProperty('stack');
    expect(res.body.error.message).not.toMatch(/C:\\/);
    expect(res.body.error.message).not.toMatch(/\/home\//);
  });
});
