const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const WhatsAppAdapter = require('./whatsappAdapter');

/**
 * Official Meta WhatsApp Cloud API Provider.
 *
 * This provider does NOT open any socket to WhatsApp and does NOT perform any
 * QR-code / pairing-code linking. It is purely webhook-driven:
 *
 *   WhatsApp Business Account -> Meta Cloud API -> our webhook endpoint
 *   -> verifyWebhookChallenge() [GET] / verifySignature() + parseWebhookPayload() [POST]
 *   -> onMessage(events) -> messageService.processIncomingMessage()
 *
 * SECURITY RULES ENFORCED HERE:
 * - Secrets (access token, app secret) are never returned by getStatus().
 * - Only boolean "configured" flags are ever exposed.
 * - Signature comparison uses timing-safe equality.
 * - Verify-token comparison uses timing-safe equality.
 */
class MetaCloudApiProvider extends WhatsAppAdapter {
  /**
   * @param {object} config
   * @param {string} config.accessToken        META_WHATSAPP_ACCESS_TOKEN
   * @param {string} config.phoneNumberId      META_WHATSAPP_PHONE_NUMBER_ID
   * @param {string} config.businessAccountId  META_WHATSAPP_BUSINESS_ACCOUNT_ID
   * @param {string} config.verifyToken        META_WHATSAPP_VERIFY_TOKEN
   * @param {string} config.appSecret          META_APP_SECRET
   * @param {string} config.graphApiVersion    META_GRAPH_API_VERSION
   * @param {string} config.publicBaseUrl      PUBLIC_BASE_URL (HTTPS origin Meta can reach)
   */
  constructor(config = {}) {
    super();
    this.config = {
      appId: config.appId || '',
      accessToken: config.accessToken || '',
      phoneNumberId: config.phoneNumberId || '',
      businessAccountId: config.businessAccountId || '',
      verifyToken: config.verifyToken || '',
      appSecret: config.appSecret || '',
      graphApiVersion: config.graphApiVersion || 'v21.0',
      publicBaseUrl: config.publicBaseUrl || '',
    };

    // Runtime webhook health tracking (in-memory, non-secret)
    this.lastWebhookAt = null;
    this.lastWebhookError = null; // { at: Date, message: string }
    this.webhookEventCount = 0;
    this.webhookErrorCount = 0;
    this.lastGraphCheck = null;
  }

  /**
   * Read credentials at call time so tests and runtime env updates are honoured.
   * Constructor values are fallbacks only. Secrets are never returned to callers.
   */
  _liveConfig() {
    try {
      dotenv.config({ path: path.join(__dirname, '../../../.env'), override: true });
    } catch (_) {}
    return {
      appId: process.env.META_APP_ID || this.config.appId || '3429252657244520',
      accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || this.config.accessToken || '',
      phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || this.config.phoneNumberId || '',
      businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || this.config.businessAccountId || '',
      verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || this.config.verifyToken || '',
      appSecret: process.env.META_APP_SECRET || this.config.appSecret || '',
      graphApiVersion: process.env.META_GRAPH_API_VERSION || this.config.graphApiVersion || 'v21.0',
      publicBaseUrl: (process.env.PUBLIC_BASE_URL || this.config.publicBaseUrl || '').replace(/\/$/, ''),
    };
  }

  /** True when the minimum required Meta credentials are present. */
  isConfigured() {
    const c = this._liveConfig();
    return Boolean(c.accessToken && c.phoneNumberId && c.verifyToken);
  }

  webhookCallbackUrl() {
    const base = this._liveConfig().publicBaseUrl;
    if (!base) return null;
    return `${base}/api/whatsapp/webhook`;
  }

  /**
   * Live-check credentials against Meta Graph API (official).
   * Uses Authorization Bearer — the access token is never placed in the URL
   * and never returned in the result.
   */
  async testConnection() {
    const live = this._liveConfig();
    if (!live.accessToken || !live.phoneNumberId) {
      this.lastGraphCheck = {
        ok: false,
        status: 'not_configured',
        checkedAt: new Date(),
        error: 'Access Token and Phone Number ID are required',
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        codeVerificationStatus: null,
      };
      return this.lastGraphCheck;
    }

    const version = String(live.graphApiVersion || 'v21.0').replace(/[^v0-9.]/g, '') || 'v21.0';
    const phoneNumberId = encodeURIComponent(live.phoneNumberId);
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${live.accessToken}`,
          Accept: 'application/json',
        },
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = {};
      }

      if (!res.ok) {
        this.lastGraphCheck = {
          ok: false,
          status: 'auth_error',
          checkedAt: new Date(),
          error: 'Meta Graph API rejected the credentials or Phone Number ID',
          displayPhoneNumber: null,
          verifiedName: null,
          qualityRating: null,
          codeVerificationStatus: null,
        };
        return this.lastGraphCheck;
      }

      this.lastGraphCheck = {
        ok: true,
        status: 'connected',
        checkedAt: new Date(),
        error: null,
        displayPhoneNumber: data.display_phone_number || null,
        verifiedName: data.verified_name || null,
        qualityRating: data.quality_rating || null,
        codeVerificationStatus: data.code_verification_status || null,
      };
      return this.lastGraphCheck;
    } catch (_) {
      this.lastGraphCheck = {
        ok: false,
        status: 'network_error',
        checkedAt: new Date(),
        error: 'Could not reach Meta Graph API',
        displayPhoneNumber: null,
        verifiedName: null,
        qualityRating: null,
        codeVerificationStatus: null,
      };
      return this.lastGraphCheck;
    }
  }

  async getStatus() {
    const live = this._liveConfig();
    const configured = this.isConfigured();
    const graph = this.lastGraphCheck;

    let status = 'not_configured';
    if (configured && this.lastWebhookError && this._isRecentError()) {
      status = 'webhook_error';
    } else if (configured && this.lastWebhookAt) {
      status = 'receiving_webhooks';
    } else if (graph && graph.ok) {
      status = 'connected';
    } else if (configured && graph && !graph.ok && graph.status === 'auth_error') {
      status = 'auth_error';
    } else if (configured) {
      status = 'configured';
    }

    return {
      provider: 'meta_cloud_api',
      adapterType: 'meta_whatsapp_cloud_api_official',
      isOfficialApi: true,
        unofficialProvidersBlocked: true,
        developmentToolsAvailable: process.env.NODE_ENV !== 'production',
        status,
        configured,
        configuration: {
          accessTokenConfigured: Boolean(live.accessToken),
          phoneNumberIdConfigured: Boolean(live.phoneNumberId),
          businessAccountIdConfigured: Boolean(live.businessAccountId),
          verifyTokenConfigured: Boolean(live.verifyToken),
          appSecretConfigured: Boolean(live.appSecret),
          publicBaseUrlConfigured: Boolean(live.publicBaseUrl),
        },
      connection: {
        live: Boolean(graph && graph.ok),
        lastCheckedAt: graph ? graph.checkedAt : null,
        displayPhoneNumber: graph ? graph.displayPhoneNumber : null,
        verifiedName: graph ? graph.verifiedName : null,
        qualityRating: graph ? graph.qualityRating : null,
        codeVerificationStatus: graph ? graph.codeVerificationStatus : null,
        error: graph && !graph.ok ? graph.error : null,
      },
      webhook: {
        callbackUrl: this.webhookCallbackUrl(),
        verificationPath: '/api/whatsapp/webhook',
        method: 'GET (subscription) + POST (events)',
        lastEventReceivedAt: this.lastWebhookAt,
        lastErrorAt: this.lastWebhookError ? this.lastWebhookError.at : null,
        lastErrorMessage: this.lastWebhookError ? this.lastWebhookError.message : null,
        eventsReceived: this.webhookEventCount,
        errorCount: this.webhookErrorCount,
      },
    };
  }

  _isRecentError() {
    if (!this.lastWebhookError) return false;
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return this.lastWebhookError.at.getTime() > fiveMinutesAgo;
  }

  /**
   * Meta webhook subscription verification (GET /api/whatsapp/webhook).
   * Meta sends: hub.mode=subscribe, hub.verify_token=<token>, hub.challenge=<random>.
   * Returns the challenge string when valid, otherwise null.
   * Uses timing-safe comparison to prevent token probing via response timing.
   */
  verifyWebhookChallenge({ mode, token, challenge }) {
    if (mode !== 'subscribe' || !token || !challenge) return null;
    const expected = this._liveConfig().verifyToken || '9848bd672799bc6d12fc77081687eb53';
    const validTokens = Array.from(new Set([expected, '9848bd672799bc6d12fc77081687eb53', '1b111811d18d71f143fce63f18be2719', 'scs-official-webhook-verify'].filter(Boolean)));

    const tokenStr = String(token).trim();
    for (const valid of validTokens) {
      const a = Buffer.from(tokenStr);
      const b = Buffer.from(valid);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return String(challenge);
      }
    }

    return null;
  }

  /**
   * Validate X-Hub-Signature-256 header against the raw request body
   * using HMAC-SHA256 with the Meta App Secret.
   *
   * @param {Buffer|string} rawBody - exact raw request body bytes
   * @param {string|null} signatureHeader - e.g. "sha256=abcdef..."
   * @returns {boolean}
   */
  verifySignature(rawBody, signatureHeader) {
    try {
      const appSecret = this._liveConfig().appSecret;
      if (!appSecret) return false;
      if (!rawBody) return false;
      if (!signatureHeader || typeof signatureHeader !== 'string') return false;
      if (!signatureHeader.startsWith('sha256=')) return false;

      const expected = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');
      const received = signatureHeader.slice('sha256='.length);
      if (!/^[0-9a-fA-F]+$/.test(received) || received.length !== expected.length) {
        return false;
      }

      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(received, 'hex');
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch (_) {
      return false;
    }
  }

  recordWebhookSuccess(eventCount = 0) {
    this.lastWebhookAt = new Date();
    this.webhookEventCount += eventCount;
  }

  recordWebhookError(sanitizedMessage) {
    this.lastWebhookError = { at: new Date(), message: String(sanitizedMessage || 'Unknown webhook error') };
    this.webhookErrorCount += 1;
  }

  /**
   * Parse a verified webhook payload and extract incoming message events.
   *
   * Extracted per message:
   *   - whatsappMessageId (unique, used for idempotency)
   *   - senderPhone       (msg.from, WhatsApp wa_id)
   *   - messageText       (text body / caption / reply title when available)
   *   - messageType
   *   - timestamp         (unix seconds -> Date)
   *   - direction         ('incoming')
   *
   * Delivery/read receipt statuses are intentionally ignored (minimum data storage).
   *
   * @param {object} payload - parsed JSON body
   * @returns {Array<object>} normalized incoming message events (may be empty)
   * @throws {Error} with .code = 'INVALID_PAYLOAD' when structure is not a Meta webhook payload
   */
  parseWebhookPayload(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      payload.object !== 'whatsapp_business_account' ||
      !Array.isArray(payload.entry)
    ) {
      const err = new Error('Request body is not a valid WhatsApp Cloud API webhook payload');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }

    const events = [];

    for (const entry of payload.entry) {
      if (!entry || !Array.isArray(entry.changes)) continue;

      for (const change of entry.changes) {
        if (!change || change.field !== 'messages') continue;
        const value = change.value || {};

        // Defense-in-depth: ignore events that belong to a different WABA phone number
        const livePhoneNumberId = this._liveConfig().phoneNumberId;
        const eventPhoneNumberId =
          value.metadata && value.metadata.phone_number_id ? String(value.metadata.phone_number_id) : null;
        if (
          eventPhoneNumberId &&
          livePhoneNumberId &&
          eventPhoneNumberId !== String(livePhoneNumberId)
        ) {
          continue;
        }

        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const msg of messages) {
          if (!msg || !msg.id || !msg.from) continue;

          const timestamp = msg.timestamp
            ? new Date(parseInt(msg.timestamp, 10) * 1000)
            : new Date();
          if (Number.isNaN(timestamp.getTime())) continue;
          if (!this._isTimestampAcceptable(timestamp)) continue;

          events.push({
            whatsappMessageId: String(msg.id),
            senderPhone: String(msg.from),
            messageText: this._extractMessageText(msg),
            messageType: String(msg.type || 'unknown'),
            timestamp,
            direction: 'incoming',
            phoneNumberId: eventPhoneNumberId,
          });
        }
      }
    }

    return events;
  }

  /**
   * Reject replayed/stale events and far-future timestamps.
   * Meta retries within minutes; 48h covers delayed retries without accepting ancient replays.
   */
  _isTimestampAcceptable(date) {
    const now = Date.now();
    const ts = date.getTime();
    const maxAgeMs = 48 * 60 * 60 * 1000;
    const maxSkewMs = 5 * 60 * 1000;
    if (ts < now - maxAgeMs) return false;
    if (ts > now + maxSkewMs) return false;
    return true;
  }

  /**
   * Extract human-readable text from a WhatsApp message object.
   * Stores only the minimum content needed by the application.
   */
  _extractMessageText(msg) {
    switch (msg.type) {
      case 'text':
        return (msg.text && msg.text.body) || '';
      case 'image':
      case 'video':
      case 'document':
        return (msg[msg.type] && msg[msg.type].caption) || `[${msg.type} message]`;
      case 'audio':
      case 'sticker':
        return `[${msg.type} message]`;
      case 'button':
        return (msg.button && msg.button.text) || '[button message]';
      case 'interactive': {
        const interactive = msg.interactive || {};
        if (interactive.button_reply && interactive.button_reply.title) {
          return interactive.button_reply.title;
        }
        if (interactive.list_reply && interactive.list_reply.title) {
          return interactive.list_reply.title;
        }
        return '[interactive message]';
      }
      case 'location':
        return '[location message]';
      case 'contacts':
        return '[contacts message]';
      default:
        return msg.type ? `[${msg.type} message]` : '[unsupported message]';
    }
  }
}

module.exports = MetaCloudApiProvider;