const rateLimit = require('express-rate-limit');

/**
 * General API Rate Limiter
 * 150 requests per 15 minutes window
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const path = req.originalUrl || req.path || '';
    return path.includes('/whatsapp/webhook');
  },
  message: {
    success: false,
    error: {
      message: 'Too many requests from this IP. Please try again after 15 minutes.',
      code: 'TOO_MANY_REQUESTS',
    },
  },
});

/**
 * Official Cloud API credential check — keep Meta Graph calls infrequent.
 */
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Connection verification rate limit reached. Try again shortly.',
      code: 'CONNECT_RATE_LIMIT',
    },
  },
});

/**
 * WhatsApp Cloud API Webhook Limiter
 * 120 webhook payloads per minute.
 * Sized generously so legitimate bursts of real Meta webhook deliveries
 * are not dropped, while still absorbing abuse.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many incoming webhook requests. Rate limit exceeded.',
      code: 'WEBHOOK_RATE_LIMIT',
    },
  },
});

/**
 * DEVELOPMENT TEST ONLY limiter
 * Strictly limits the local message-simulation endpoint (never available in
 * production). 20 simulated messages per 15 minutes.
 */
const devTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Development test endpoint rate limit reached.',
      code: 'DEV_TEST_RATE_LIMIT',
    },
  },
});

/**
 * Excel File Upload Rate Limiter
 * 10 upload attempts per 15 minutes
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Upload rate limit reached. Maximum 10 uploads per 15 minutes allowed.',
      code: 'UPLOAD_RATE_LIMIT',
    },
  },
});

/**
 * Contact Creation Limiter
 * 30 creation requests per 15 minutes
 */
const contactCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Contact creation rate limit exceeded. Please slow down.',
      code: 'CREATION_RATE_LIMIT',
    },
  },
});

module.exports = {
  apiLimiter,
  webhookLimiter,
  connectLimiter,
  devTestLimiter,
  uploadLimiter,
  contactCreationLimiter,
};