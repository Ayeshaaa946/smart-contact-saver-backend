const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { validateEnv } = require('./config/envValidator');
const errorHandler = require('./middleware/errorHandler');
const db = require('./config/db');

const {
  apiLimiter,
  webhookLimiter,
  connectLimiter,
  uploadLimiter,
  devTestLimiter,
} = require('./middleware/rateLimiter');

const contactRoutes = require('./routes/contactRoutes');
const importRoutes = require('./routes/importRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const activityRoutes = require('./routes/activityRoutes');
const conflictRoutes = require('./routes/conflictRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const messageRoutes = require('./routes/messageRoutes');

// 1. Validate environment secrets & config at startup
const envConfig = validateEnv();

const app = express();

// Ensure uploads directory exists
if (!fs.existsSync(config.uploadDir)) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

// 2. Security HTTP Headers via Helmet
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// 3. Robust CORS Configuration
const defaultOrigins = [
  'https://smart-contact-saver.netlify.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const configuredOrigins = envConfig.clientOrigin
  ? envConfig.clientOrigin.split(',').map((o) => o.trim())
  : [];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins])).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // If wildcard or exact match in configured origins
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow all Netlify deployments (custom domains, deploy previews, subdomains)
    if (/^https:\/\/[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*\.netlify\.(app|live)$/.test(origin)) {
      return callback(null, true);
    }

    // Allow Railway domains
    if (/^https:\/\/[a-zA-Z0-9_-]+\.up\.railway\.app$/.test(origin)) {
      return callback(null, true);
    }

    // Allow localhost/127.0.0.1 on any port
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // Fallback: allow origin to prevent network errors when frontend URL changes
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Total-Count'],
};

app.use(cors(corsOptions));

// Capture the RAW request body so webhook HMAC signatures can be verified
// against the exact bytes Meta signed (express.json parses afterwards).
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

if (envConfig.nodeEnv !== 'test') {
  app.use(
    morgan((tokens, req, res) => {
      const rawUrl = tokens.url(req, res) || '';
      const url = rawUrl
        .replace(/hub\.verify_token=[^&]*/gi, 'hub.verify_token=REDACTED')
        .replace(/access_token=[^&]*/gi, 'access_token=REDACTED');
      return [
        tokens.method(req, res),
        url,
        tokens.status(req, res),
        tokens.res(req, res, 'content-length'),
        '-',
        tokens['response-time'](req, res),
        'ms',
      ].join(' ');
    })
  );
}

// 4. Rate Limiting Middleware
app.use('/api/', apiLimiter);

// 5. Strictly serve uploads directory only; prevent access to root or auth session folders
app.use('/uploads', (req, res, next) => {
  // Prevent path traversal attempts and block any credential/session artifacts
  // (legacy unofficial-session folders, env files) from ever being served.
  const safePath = path.normalize(req.path).replace(/^(\.\.[\/\\])+/, '');
  const blockedPatterns = ['.baileys_auth', '.wwebjs_auth', '.env', 'creds.json', 'session'];
  if (blockedPatterns.some((p) => safePath.toLowerCase().includes(p))) {
    return res.status(403).json({ success: false, error: { message: 'Access denied', code: 'FORBIDDEN' } });
  }
  express.static(config.uploadDir)(req, res, next);
});

// Health check route with database connectivity test
app.get('/api/health', async (req, res) => {
  let dbStatus = 'not_configured';
  let dbMessage = 'DATABASE_URL environment variable is not set';

  if (process.env.DATABASE_URL) {
    try {
      await Promise.race([
        db.contact.count(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timed out after 5s')), 5000)),
      ]);
      dbStatus = 'connected';
      dbMessage = 'Connected to MongoDB Atlas';
    } catch (err) {
      dbStatus = 'connection_failed';
      dbMessage = 'Failed to connect: ' + (err.message || 'Timeout/Network error');
    }
  }

  const whatsappReady = Boolean(
    process.env.META_WHATSAPP_ACCESS_TOKEN &&
      process.env.META_WHATSAPP_PHONE_NUMBER_ID &&
      process.env.META_WHATSAPP_VERIFY_TOKEN
  );

  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    message: 'Smart WhatsApp Contact Saver API is running',
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus,
      message: dbMessage,
      configured: Boolean(process.env.DATABASE_URL),
    },
    whatsapp: {
      status: whatsappReady ? 'configured' : 'not_configured',
    },
    timestamp: new Date().toISOString(),
  });
});

// Dedicated Rate Limiters on Sensitive Endpoints
app.use('/api/imports/upload', uploadLimiter);
app.use('/api/whatsapp/webhook', webhookLimiter);
app.use('/api/whatsapp/connect', connectLimiter);
app.use('/api/whatsapp/dev', devTestLimiter);

// API Routes
app.use('/api/contacts', contactRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/conflicts', conflictRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/messages', messageRoutes);

// Serve production frontend build if present
const frontendBuildDir = path.join(__dirname, '../../frontend/build');
if (fs.existsSync(frontendBuildDir)) {
  app.use(express.static(frontendBuildDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      return res.sendFile(path.join(frontendBuildDir, 'index.html'));
    }
    next();
  });
}

// 404 Handler for unhandled API routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      statusCode: 404,
    },
  });
});

// Global Error Handler
app.use(errorHandler);

// Start Server if called directly
if (require.main === module) {
  (async () => {
    try {
      const PORT = process.env.PORT || envConfig.port || 5000;

      // 1. Establish MongoDB connection before starting the HTTP server
      if (process.env.DATABASE_URL) {
        try {
          console.log('Connecting to MongoDB Atlas database...');
          await db.$connect();
          console.log('✅ MongoDB connection established successfully.');

          // Non-destructive initial seed check if the database is brand new and empty
          try {
            const count = await db.contact.count();
            if (count === 0) {
              console.log('Database empty. Seeding initial MongoDB contacts...');
              const { seedDatabase } = require('../prisma/seed');
              await seedDatabase();
            }
          } catch (seedErr) {
            console.warn('Initial seeding check notice:', seedErr.message);
          }
        } catch (dbErr) {
          console.error('❌ Failed to connect to MongoDB at DATABASE_URL:', dbErr.message);
          if (process.env.NODE_ENV === 'production') {
            process.exit(1);
          }
        }
      } else {
        if (process.env.NODE_ENV === 'production') {
          console.error('❌ Critical Error: DATABASE_URL environment variable is required in production.');
          process.exit(1);
        } else {
          console.warn('⚠️ DATABASE_URL is not set. Set DATABASE_URL in .env to connect to MongoDB Atlas.');
        }
      }

      const server = app.listen(PORT, '0.0.0.0', () => {
        const whatsappReady = Boolean(
          process.env.META_WHATSAPP_ACCESS_TOKEN &&
            process.env.META_WHATSAPP_PHONE_NUMBER_ID &&
            process.env.META_WHATSAPP_VERIFY_TOKEN
        );
        console.log(`=======================================================`);
        console.log(`Smart WhatsApp Contact Saver Backend running on port ${PORT}`);
        console.log(`Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
        console.log(`WhatsApp: official Meta Cloud API ${whatsappReady ? '(credentials present)' : '(not configured — set META_* in env)'}`);
        console.log(`Health Check: GET /api/health`);
        console.log(`=======================================================`);
      });

      // Graceful shutdown handling
      const handleShutdown = async (signal) => {
        console.log(`\nReceived ${signal}. Shutting down gracefully...`);
        server.close(async () => {
          try {
            await db.$disconnect();
          } catch (_) {}
          console.log('HTTP server and database connections closed.');
          process.exit(0);
        });
      };

      process.on('SIGTERM', () => handleShutdown('SIGTERM'));
      process.on('SIGINT', () => handleShutdown('SIGINT'));
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  })();
}

module.exports = app;
