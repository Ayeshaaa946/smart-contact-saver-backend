const request = require('supertest');
const crypto = require('crypto');
const db = require('../src/config/db');
const { normalizePhoneNumber } = require('../src/services/phoneService');
const { processIncomingMessage, saveUnknownSender } = require('../src/services/messageService');
const MetaCloudApiProvider = require('../src/services/whatsapp/metaCloudApiProvider');

describe('WhatsApp Sender Normalization & Contact Matching Suite', () => {
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

  test('Case D: Extensible phone normalization handles Pakistan & International numbers', () => {
    // Pakistani variations
    const pk1 = normalizePhoneNumber('03001234567', 'PK');
    const pk2 = normalizePhoneNumber('+92 300 1234567', 'PK');
    const pk3 = normalizePhoneNumber('923001234567', 'PK');

    expect(pk1.normalizedNumber).toBe('+923001234567');
    expect(pk2.normalizedNumber).toBe('+923001234567');
    expect(pk3.normalizedNumber).toBe('+923001234567');
    expect(pk1.countryCode).toBe('PK');

    // International US number
    const us = normalizePhoneNumber('+1 202 555 0123', 'US');
    expect(us.isValid).toBe(true);
    expect(us.normalizedNumber).toBe('+12025550123');
  });

  test('Same phone + same name resolves to same normalized contact match', () => {
    const n1 = normalizePhoneNumber('03001234567', 'PK');
    const n2 = normalizePhoneNumber('+92 300 1234567', 'PK');
    expect(n1.normalizedNumber).toBe(n2.normalizedNumber);
  });

  test('Incoming WhatsApp message normalizes sender and matches existing MongoDB contact', async () => {
    // 1. Create test contact in MongoDB
    const contact = await db.contact.create({
      data: {
        name: 'Ali Khan',
        phoneNumbers: {
          create: {
            originalNumber: '+92 300 1234567',
            normalizedNumber: '+923001234567',
            isPrimary: true,
          },
        },
      },
    });

    // 2. Process incoming message from raw local format '03001234567'
    const result = await processIncomingMessage({
      senderPhone: '03001234567',
      messageText: 'Hello from WhatsApp!',
      whatsappMessageId: 'wa_test_msg_101',
    });

    expect(result.isDuplicate).toBe(false);
    expect(result.matchedContact).not.toBeNull();
    expect(result.matchedContact.id).toBe(contact.id);
    expect(result.matchedContact.name).toBe('Ali Khan');
    expect(result.message.normalizedPhone).toBe('+923001234567');
  });

  test('Duplicate incoming WhatsApp messages are safely ignored (idempotency)', async () => {
    // Re-send same messageId
    const result = await processIncomingMessage({
      senderPhone: '03001234567',
      messageText: 'Hello from WhatsApp!',
      whatsappMessageId: 'wa_test_msg_101',
    });

    expect(result.isDuplicate).toBe(true);

    // Ensure no duplicate Message records
    const count = await db.message.count({ where: { whatsappMessageId: 'wa_test_msg_101' } });
    expect(count).toBe(1);
  });

  test('Unknown WhatsApp sender creates unlinked message and can be saved as new contact', async () => {
    const unknownPhone = '03001122334';

    // 1. Process incoming message from unknown sender
    const result = await processIncomingMessage({
      senderPhone: unknownPhone,
      messageText: 'Unrecognized inquiry',
      whatsappMessageId: 'wa_unknown_msg_202',
    });

    expect(result.matchedContact).toBeNull();
    expect(result.message.contactId).toBeNull();

    // 2. User saves the unknown sender via saveUnknownSender
    const savedContact = await saveUnknownSender({
      name: 'Tariq Mehmood',
      phone: unknownPhone,
    });

    expect(savedContact.name).toBe('Tariq Mehmood');

    // 3. Verify previous message is now linked to Tariq Mehmood
    const updatedMsg = await db.message.findUnique({
      where: { whatsappMessageId: 'wa_unknown_msg_202' },
    });
    expect(updatedMsg.contactId).toBe(savedContact.id);
  });

  test('Invalid phone numbers are rejected & never stored as matching keys', async () => {
    const invalid = normalizePhoneNumber('not-a-phone', 'PK');
    expect(invalid.isValid).toBe(false);
    expect(invalid.normalizedNumber).toBeNull();

    await expect(
      processIncomingMessage({
        senderPhone: '',
        messageText: 'bad',
        whatsappMessageId: 'wa_bad_001',
      })
    ).rejects.toThrow('Sender phone number is required');
  });

  // ============================================================
  // Official Meta Cloud API status / webhook endpoint tests
  // ============================================================

  test('GET /api/whatsapp/status returns official Meta Cloud API provider status', async () => {
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('status');
    expect(res.body.data.isOfficialApi).toBe(true);
    expect(res.body.data.provider).toBe('meta_cloud_api');
    expect(res.body.data.configuration).toHaveProperty('accessTokenConfigured');
    // Secrets must never be exposed
    expect(res.body.data).not.toHaveProperty('accessToken');
    expect(res.body.data).not.toHaveProperty('appSecret');
    expect(res.body.data).not.toHaveProperty('verifyToken');
    expect(JSON.stringify(res.body)).not.toMatch(/META_WHATSAPP_ACCESS_TOKEN|META_APP_SECRET/);
  });

  test('GET /api/whatsapp/webhook verifies challenge with correct verify token', async () => {
    // Test provider directly with a configured verify token
    const provider = new MetaCloudApiProvider({ verifyToken: 'my-test-token' });
    const challenge = provider.verifyWebhookChallenge({
      mode: 'subscribe',
      token: 'my-test-token',
      challenge: '1234567890',
    });
    expect(challenge).toBe('1234567890');
  });

  test('GET /api/whatsapp/webhook rejects wrong verify token', async () => {
    const provider = new MetaCloudApiProvider({ verifyToken: 'my-test-token' });
    const result = provider.verifyWebhookChallenge({
      mode: 'subscribe',
      token: 'WRONG_TOKEN',
      challenge: '1234567890',
    });
    expect(result).toBeNull();
  });

  test('Webhook signature validation rejects forged requests', async () => {
    const provider = new MetaCloudApiProvider({ appSecret: 'super-secret-app-secret' });
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    // Compute valid signature
    const validSig = crypto
      .createHmac('sha256', 'super-secret-app-secret')
      .update(body)
      .digest('hex');

    // Valid signature passes
    expect(provider.verifySignature(Buffer.from(body), `sha256=${validSig}`)).toBe(true);

    // Forged / tampered body fails
    expect(provider.verifySignature(Buffer.from(body + 'x'), `sha256=${validSig}`)).toBe(false);

    // Wrong signature fails
    expect(provider.verifySignature(Buffer.from(body), 'sha256=deadbeef')).toBe(false);

    // Missing signature header fails
    expect(provider.verifySignature(Buffer.from(body), null)).toBe(false);

    // Wrong header prefix fails
    expect(provider.verifySignature(Buffer.from(body), `md5=${validSig}`)).toBe(false);
  });

  test('POST /api/whatsapp/webhook with real Meta-shaped payload processes matched incoming message', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const metaPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456789012345',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15551234567',
                  phone_number_id: '123456789012345',
                },
                contacts: [{ profile: { name: 'Ali Khan' }, wa_id: '923001234567' }],
                messages: [
                  {
                    from: '923001234567',
                    id: 'wamid.real-meta-message-id-001',
                    timestamp: String(timestamp),
                    text: { body: 'Hello, are you available?' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send(metaPayload);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.received).toBe(1);
    expect(res.body.processed).toBe(1);
    expect(res.body.failures).toBe(0);
  });

  test('POST /api/whatsapp/webhook rejects arbitrary non-Meta payloads', async () => {
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .send({
        senderPhone: '+92 300 1234567',
        messageText: 'This is NOT a Meta payload',
        whatsappMessageId: 'wh_invalid_001',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_PAYLOAD');
  });

  test('POST /api/whatsapp/webhook ignores duplicates via unique whatsappMessageId', async () => {
    const metaPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '123456789012345',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '123456789012345' },
                contacts: [{ wa_id: '923001234567' }],
                messages: [
                  {
                    from: '923001234567',
                    id: 'wamid.duplicate-msg-001',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: 'Duplicate test' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    // First send - processed
    const first = await request(app).post('/api/whatsapp/webhook').send(metaPayload);
    expect(first.body.processed).toBe(1);

    // Second identical send - must be deduplicated
    const second = await request(app).post('/api/whatsapp/webhook').send(metaPayload);
    expect(second.body.processed).toBe(0);
    expect(second.body.duplicates).toBe(1);
  });

  test('Development test endpoint is clearly labeled and functional in development', async () => {
    const res = await request(app)
      .post('/api/whatsapp/dev/test-message')
      .send({ senderPhone: '03001234567', messageText: 'Dev test' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.developmentOnly).toBe(true);
    expect(res.body.data.notice).toMatch(/DEVELOPMENT TEST ONLY/i);
    expect(res.body.data.matched).toBe(true);
    expect(res.body.data.contactName).toBe('Ali Khan');
  });

  test('POST /api/whatsapp/connect without credentials reports not connected and leaks no secrets', async () => {
    const res = await request(app).post('/api/whatsapp/connect');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.connected).toBe(false);
    expect(res.body.data.isOfficialApi).toBe(true);
    expect(res.body.data.unofficialProvidersBlocked).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/META_WHATSAPP_ACCESS_TOKEN|SECRET_TOKEN|Bearer /);
  });

  test('Official Graph API connection test never puts the access token in the URL or status payload', async () => {
    const secret = 'SECRET_TOKEN_VALUE_XYZ';
    const provider = new MetaCloudApiProvider({
      accessToken: secret,
      phoneNumberId: '10987654321',
      verifyToken: 'tok',
    });
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      expect(String(url)).not.toContain(secret);
      expect(String(url)).toContain('graph.facebook.com');
      expect(opts.headers.Authorization).toBe(`Bearer ${secret}`);
      return {
        ok: true,
        json: async () => ({
          display_phone_number: '+1 555-0100',
          verified_name: 'Test Biz',
          quality_rating: 'GREEN',
          code_verification_status: 'VERIFIED',
        }),
      };
    });
    try {
      const result = await provider.testConnection();
      expect(result.ok).toBe(true);
      expect(result.displayPhoneNumber).toBe('+1 555-0100');
      expect(JSON.stringify(result)).not.toContain(secret);

      const status = await provider.getStatus();
      expect(status.status).toBe('connected');
      expect(status.isOfficialApi).toBe(true);
      expect(status.connection.live).toBe(true);
      expect(JSON.stringify(status)).not.toContain(secret);
    } finally {
      global.fetch = originalFetch;
    }
  });
});