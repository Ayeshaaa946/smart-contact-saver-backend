/**
 * Abstract WhatsApp Provider Interface.
 *
 * Keeps contact matching and business logic completely decoupled from any
 * specific WhatsApp transport implementation.
 *
 * Contract for any provider:
 *   - getStatus(): Promise<object>          -> non-secret status snapshot
 *   - onMessage(callback)                   -> register incoming-message handler
 *   - verifyWebhookChallenge(params)        -> GET subscription verification
 *   - verifySignature(rawBody, header)      -> POST request authenticity check
 *   - parseWebhookPayload(payload)          -> extract normalized message events
 */
class WhatsAppAdapter {
  constructor() {
    this.onMessageCallback = null;
  }

  /** Register the callback invoked with each normalized incoming message event. */
  onMessage(callback) {
    this.onMessageCallback = callback;
  }

  async getStatus() {
    throw new Error('getStatus() must be implemented by provider subclass');
  }

  /**
   * Verify a webhook subscription challenge (GET).
   * @returns {string|null} challenge echo when valid, otherwise null
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhookChallenge({ mode, token, challenge }) {
    throw new Error('verifyWebhookChallenge() must be implemented by provider subclass');
  }

  /**
   * Validate webhook request authenticity (POST).
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  verifySignature(rawBody, signatureHeader) {
    throw new Error('verifySignature() must be implemented by provider subclass');
  }

  /**
   * Parse a verified webhook payload into normalized message events.
   * @returns {Array<object>}
   */
  // eslint-disable-next-line no-unused-vars
  parseWebhookPayload(payload) {
    throw new Error('parseWebhookPayload() must be implemented by provider subclass');
  }
}

module.exports = WhatsAppAdapter;