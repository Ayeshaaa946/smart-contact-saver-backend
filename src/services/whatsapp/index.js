const MetaCloudApiProvider = require('./metaCloudApiProvider');
const config = require('../../config');

/**
 * Provider registry.
 *
 * WhatsApp integration layer for official Meta WhatsApp Cloud API.
 */
const PROVIDERS = {
  meta_cloud_api: () =>
    new MetaCloudApiProvider({
      accessToken: config.meta.accessToken,
      phoneNumberId: config.meta.phoneNumberId,
      businessAccountId: config.meta.businessAccountId,
      verifyToken: config.meta.verifyToken,
      appSecret: config.meta.appSecret,
      graphApiVersion: config.meta.graphApiVersion,
      publicBaseUrl: config.meta.publicBaseUrl,
    }),
};

function createProvider() {
  const requested = (process.env.WHATSAPP_PROVIDER || 'meta_cloud_api').toLowerCase().trim();
  const factory = PROVIDERS[requested];
  if (!factory) {
    return PROVIDERS.meta_cloud_api();
  }
  return factory();
}

/**
 * WhatsApp Service Manager.
 * Owns the active provider and wires incoming webhook events into the
 * contact-matching pipeline (messageService.processIncomingMessage).
 */
class WhatsAppServiceManager {
  constructor() {
    this.provider = createProvider();
  }

  getProvider() {
    return this.provider;
  }

  async getStatus() {
    return this.provider.getStatus();
  }

  async testOfficialConnection() {
    return this.provider.testConnection();
  }
}

// Singleton instance shared across the application
const instance = new WhatsAppServiceManager();
module.exports = instance;