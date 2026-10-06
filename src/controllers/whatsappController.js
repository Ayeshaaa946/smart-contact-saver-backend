const crypto = require('crypto');
const whatsAppService = require('../services/whatsapp');
const { processIncomingMessage } = require('../services/messageService');
const config = require('../config');
const { success } = require('../utils/apiResponse');
const { ValidationError } = require('../utils/errors');

/**
 * GET /api/whatsapp/status
 * Returns WhatsApp Business integration status.
 * Contains ONLY booleans and non-secret metadata — never tokens or secrets.
 */
async function getStatus(req, res, next) {
  try {
    const status = await whatsAppService.getStatus();
    return success(res, status);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/whatsapp/connect
 * Verifies official Meta Cloud API credentials by calling Graph API
 * GET /{phone-number-id}. Never returns tokens or secrets.
 */
async function connectOfficialApi(req, res, next) {
  try {
    const result = await whatsAppService.testOfficialConnection();
    const status = await whatsAppService.getStatus();
    return success(res, {
      connected: Boolean(result.ok),
      ...status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/whatsapp/webhook
 * Meta webhook subscription verification (hub challenge).
 *
 * Meta calls this endpoint with:
 *   hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
 *
 * On success we MUST respond with the plain-text challenge.
 * On failure respond 403 without echoing any token material.
 */
async function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const provider = whatsAppService.getProvider();
  const result = provider.verifyWebhookChallenge({ mode, token, challenge });

  if (result === null) {
    provider.recordWebhookError('Webhook subscription verification failed');
    return res.status(403).type('text/plain').send('Forbidden');
  }

  return res.status(200).type('text/plain').send(result);
}

/**
 * POST /api/whatsapp/webhook
 * Receives official WhatsApp Cloud API events from Meta.
 *
 * Security pipeline:
 *   1. Verify X-Hub-Signature-256 HMAC-SHA256 signature against the RAW body
 *      using META_APP_SECRET (timing-safe comparison).
 *   2. Fail CLOSED in production when META_APP_SECRET is not configured.
 *   3. Strictly validate payload structure (object === 'whatsapp_business_account').
 *   4. Extract sender phone, message id, text, timestamp from message events only.
 *   5. Idempotency: unique whatsappMessageId prevents duplicate Message records.
 *   6. Never echo secrets or internal details in responses.
 */
async function handleWebhook(req, res) {
  const provider = whatsAppService.getProvider();
  const signatureHeader = req.get('x-hub-signature-256') || null;
  const rawBody = req.rawBody;

  // --- Step 1 & 2: Signature enforcement (fail closed) ---
  const appSecretConfigured = Boolean(provider._liveConfig().appSecret);
  if (appSecretConfigured) {
    if (!rawBody || !provider.verifySignature(rawBody, signatureHeader)) {
      provider.recordWebhookError('Rejected request: invalid or missing webhook signature');
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid webhook signature', code: 'INVALID_SIGNATURE' },
      });
    }
  } else if (process.env.NODE_ENV === 'production') {
    // Fail closed: never accept unauthenticated webhook events in production
    provider.recordWebhookError('Rejected request: META_APP_SECRET not configured');
    return res.status(503).json({
      success: false,
      error: {
        message: 'WhatsApp webhook is not configured',
        code: 'WEBHOOK_NOT_CONFIGURED',
      },
    });
  } else {
    // Development convenience only: unsigned payloads allowed outside production.
    console.warn(
      '[WhatsApp] WARNING: Accepting UNSIGNED webhook payload because META_APP_SECRET is not set (non-production environment only).'
    );
  }

  // --- Step 3: Structural validation ---
  let events;
  try {
    events = provider.parseWebhookPayload(req.body);
  } catch (err) {
    provider.recordWebhookError('Rejected request: malformed webhook payload');
    return res.status(400).json({
      success: false,
      error: { message: 'Malformed webhook payload', code: 'INVALID_PAYLOAD' },
    });
  }

  // --- Steps 4-5: Process each extracted message event ---
  let processed = 0;
  let duplicates = 0;
  let failures = 0;

  for (const event of events) {
    try {
      const result = await processIncomingMessage({
        senderPhone: event.senderPhone,
        messageText: event.messageText,
        whatsappMessageId: event.whatsappMessageId,
        timestamp: event.timestamp,
        messageType: event.messageType,
        defaultCountry: config.defaultCountry,
      });
      if (result.isDuplicate) duplicates += 1;
      else processed += 1;
    } catch (err) {
      failures += 1;
      // Minimal operational logging only — no message content, no secrets.
      console.error('[WhatsApp] Event processing failure:', err.message);
    }
  }

  provider.recordWebhookSuccess(events.length);

  // --- Step 6: Safe response ---
  return res.status(200).json({
    success: true,
    received: events.length,
    processed,
    duplicates,
    failures,
  });
}

const fs = require('fs');
const path = require('path');

/**
 * Helper to persist updated configuration keys to backend/.env
 */
function updateEnvFile(updates) {
  const envPath = path.join(__dirname, '../../.env');
  let content = '';
  try {
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf8');
    }
  } catch (_) {}

  const lines = content.split(/\r?\n/);
  const updatedKeys = new Set();

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) return line;
    const key = line.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      updatedKeys.add(key);
      const val = updates[key] !== undefined ? updates[key] : '';
      return `${key}=${val}`;
    }
    return line;
  });

  // Append any keys that weren't already in .env
  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key) && val !== undefined) {
      newLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');

  // Also update process.env & config in memory
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      process.env[key] = String(val);
    }
  }
  if (config.meta) {
    if (updates.META_APP_ID !== undefined) config.meta.appId = updates.META_APP_ID;
    if (updates.META_WHATSAPP_ACCESS_TOKEN !== undefined) config.meta.accessToken = updates.META_WHATSAPP_ACCESS_TOKEN;
    if (updates.META_WHATSAPP_PHONE_NUMBER_ID !== undefined) config.meta.phoneNumberId = updates.META_WHATSAPP_PHONE_NUMBER_ID;
    if (updates.META_WHATSAPP_BUSINESS_ACCOUNT_ID !== undefined) config.meta.businessAccountId = updates.META_WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (updates.META_WHATSAPP_VERIFY_TOKEN !== undefined) config.meta.verifyToken = updates.META_WHATSAPP_VERIFY_TOKEN;
    if (updates.META_APP_SECRET !== undefined) config.meta.appSecret = updates.META_APP_SECRET;
    if (updates.PUBLIC_BASE_URL !== undefined) config.meta.publicBaseUrl = updates.PUBLIC_BASE_URL;
  }
}

/**
 * GET /api/whatsapp/config
 * Returns current configuration values (excluding raw secrets).
 */
async function getConfig(req, res, next) {
  try {
    const provider = whatsAppService.getProvider();
    const live = provider._liveConfig();
    const status = await whatsAppService.getStatus();

    return success(res, {
      appId: live.appId || '3429252657244520',
      phoneNumberId: live.phoneNumberId || '',
      businessAccountId: live.businessAccountId || '',
      verifyToken: live.verifyToken || '9848bd672799bc6d12fc77081687eb53',
      publicBaseUrl: live.publicBaseUrl || '',
      graphApiVersion: live.graphApiVersion || 'v21.0',
      hasAccessToken: Boolean(live.accessToken),
      hasAppSecret: Boolean(live.appSecret),
      status: status.status,
      connection: status.connection,
      webhook: status.webhook,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/whatsapp/config
 * Updates WhatsApp credentials in backend/.env and runtime config.
 */
async function saveConfig(req, res, next) {
  try {
    const {
      appId,
      accessToken,
      phoneNumberId,
      businessAccountId,
      verifyToken,
      appSecret,
      publicBaseUrl,
      graphApiVersion,
    } = req.body || {};

    const updates = {};
    if (appId !== undefined) updates.META_APP_ID = String(appId).trim();
    if (accessToken !== undefined) updates.META_WHATSAPP_ACCESS_TOKEN = String(accessToken).trim();
    if (phoneNumberId !== undefined) updates.META_WHATSAPP_PHONE_NUMBER_ID = String(phoneNumberId).trim();
    if (businessAccountId !== undefined) updates.META_WHATSAPP_BUSINESS_ACCOUNT_ID = String(businessAccountId).trim();
    if (verifyToken !== undefined) updates.META_WHATSAPP_VERIFY_TOKEN = String(verifyToken).trim();
    if (appSecret !== undefined) updates.META_APP_SECRET = String(appSecret).trim();
    if (publicBaseUrl !== undefined) updates.PUBLIC_BASE_URL = String(publicBaseUrl).trim().replace(/\/$/, '');
    if (graphApiVersion !== undefined) updates.META_GRAPH_API_VERSION = String(graphApiVersion).trim();

    updateEnvFile(updates);

    // Test connection if minimum credentials are provided
    let connResult = null;
    const provider = whatsAppService.getProvider();
    if (provider.isConfigured()) {
      connResult = await whatsAppService.testOfficialConnection();
    }

    const status = await whatsAppService.getStatus();

    return success(res, {
      saved: true,
      connected: Boolean(connResult && connResult.ok),
      ...status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/whatsapp/dev/test-message
 * Simulates an incoming WhatsApp message to test normalization and contact matching.
 */
async function devTestMessage(req, res, next) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({
        success: false,
        error: { message: 'Not found', code: 'NOT_FOUND' },
      });
    }

    const { senderPhone, messageText, whatsappMessageId } = req.body || {};
    if (!senderPhone || !String(senderPhone).trim()) {
      throw new ValidationError('senderPhone is required');
    }

    const result = await processIncomingMessage({
      senderPhone: String(senderPhone).trim(),
      messageText: messageText ? String(messageText) : 'Hello',
      whatsappMessageId:
        whatsappMessageId && String(whatsappMessageId).trim()
          ? `test_${String(whatsappMessageId).trim()}`
          : `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
      defaultCountry: config.defaultCountry,
    });

    return success(res, {
      developmentOnly: true,
      notice: 'Simulated incoming message processed successfully',
      matched: Boolean(result.matchedContact),
      contactName: result.matchedContact ? result.matchedContact.name : null,
      contactId: result.matchedContact ? result.matchedContact.id : null,
      normalizedPhone: result.message.normalizedPhone,
      isDuplicate: result.isDuplicate,
      messageId: result.message.id,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStatus,
  getConfig,
  saveConfig,
  connectOfficialApi,
  verifyWebhook,
  handleWebhook,
  devTestMessage,
};
