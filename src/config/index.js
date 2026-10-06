const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  defaultCountry: process.env.DEFAULT_COUNTRY || 'PK',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,
  uploadDir: path.join(__dirname, '../../uploads'),
  allowedExtensions: ['.xlsx', '.xls'],
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100,
  },
  /**
   * Official Meta WhatsApp Cloud API credentials.
   * Loaded from environment variables ONLY — never hard-coded.
   * These values must NEVER be logged or returned in API responses.
   */
  meta: {
    appId: process.env.META_APP_ID || '3429252657244520',
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
    graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v21.0',
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  },
};

module.exports = config;
