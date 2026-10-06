/**
 * Environment Variable Validator.
 * Validates required backend secrets and configuration at startup.
 * Halts boot if critical environment variable misconfigurations are detected.
 *
 * Meta WhatsApp Cloud API variables are OPTIONAL at boot time so the app can
 * run before business configuration is completed; missing values simply put
 * the WhatsApp integration into "not_configured" state until they are set.
 */
function validateEnv() {
  const errors = [];
  const warnings = [];

  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      errors.push('DATABASE_URL environment variable is required to connect to MongoDB Atlas in production');
    } else {
      warnings.push('DATABASE_URL is not set — please configure your MongoDB Atlas connection string in .env');
    }
  }

  // Ensure CLIENT_ORIGIN is configured for CORS restriction
  if (!process.env.CLIENT_ORIGIN) {
    process.env.CLIENT_ORIGIN =
      process.env.NODE_ENV === 'production'
        ? 'https://smart-contact-saver.netlify.app'
        : 'http://localhost:3000';
  }

  if (!process.env.PORT) {
    process.env.PORT = '5000';
  }

  if (!process.env.DEFAULT_COUNTRY) {
    process.env.DEFAULT_COUNTRY = 'PK';
  }

  // Security warning if running in production with default settings
  if (process.env.NODE_ENV === 'production') {
    if (process.env.CLIENT_ORIGIN === '*') {
      warnings.push('Security Notice: CLIENT_ORIGIN is set to "*". For strict security, specify your exact Netlify domain.');
    }

    // Production hardening warnings for the WhatsApp integration (non-fatal)
    const metaRequired = [
      ['META_WHATSAPP_ACCESS_TOKEN', 'Access Token'],
      ['META_WHATSAPP_PHONE_NUMBER_ID', 'Phone Number ID'],
      ['META_WHATSAPP_VERIFY_TOKEN', 'Webhook Verify Token'],
      ['META_APP_SECRET', 'App Secret'],
    ];
    for (const [key, label] of metaRequired) {
      if (!process.env[key]) {
        warnings.push(`WhatsApp Cloud API: ${label} (${key}) is not set - webhook will reject events`);
      }
    }
    if (!process.env.PUBLIC_BASE_URL) {
      warnings.push('PUBLIC_BASE_URL is not set - Meta cannot reach the webhook over HTTPS');
    }
  }

  if (errors.length > 0) {
    console.error('=======================================================');
    console.error('ENVIRONMENT CONFIGURATION SECURITY ERRORS:');
    errors.forEach((e) => console.error(` - ${e}`));
    console.error('=======================================================');
    throw new Error('Environment variable validation failed');
  }

  if (warnings.length > 0) {
    console.warn('-------------------------------------------------------');
    console.warn('Environment configuration warnings:');
    warnings.forEach((w) => console.warn(` - ${w}`));
    console.warn('-------------------------------------------------------');
  }

  return {
    databaseUrl: process.env.DATABASE_URL,
    clientOrigin: process.env.CLIENT_ORIGIN,
    port: parseInt(process.env.PORT, 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    defaultCountry: process.env.DEFAULT_COUNTRY,
  };
}

module.exports = { validateEnv };