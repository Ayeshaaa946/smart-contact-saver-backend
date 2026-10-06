const request = require('supertest');
const db = require('../src/config/db');

describe('Contacts & Health API Integration Tests', () => {
  let app;

  beforeAll(async () => {
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
    try {
      await db.$disconnect();
    } catch (_) {}
  });

  test('GET /api/health returns 200 OK', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('POST /api/contacts creates a contact with normalized phone', async () => {
    const randomPhone = `0300${Math.floor(1000000 + Math.random() * 9000000)}`;
    const res = await request(app)
      .post('/api/contacts')
      .send({
        name: 'Test Automation Contact',
        phone: randomPhone,
        email: 'test@automation.com',
      });

    if (res.statusCode !== 201) {
      console.log('POST /api/contacts Error details:', JSON.stringify(res.body, null, 2));
    }

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Test Automation Contact');
    expect(res.body.data.phoneNumbers[0].normalizedNumber).toMatch(/^\+92/);
  }, 30000);

  test('GET /api/contacts returns paginated contact list', async () => {
    const res = await request(app).get('/api/contacts?page=1&limit=5');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  test('GET /api/dashboard/stats returns aggregate metrics', async () => {
    const res = await request(app).get('/api/dashboard/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalContacts');
    expect(res.body.data).toHaveProperty('pendingConflicts');
  });
});
