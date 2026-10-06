const { PrismaClient } = require('@prisma/client');

let _client = null;

/**
 * Returns (or lazily creates) the singleton PrismaClient.
 * Connects to MongoDB Atlas using process.env.DATABASE_URL.
 */
function getClient() {
  if (!_client) {
    const options = {
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    };
    if (process.env.DATABASE_URL) {
      options.datasources = { db: { url: process.env.DATABASE_URL } };
    }
    _client = new PrismaClient(options);
  }
  return _client;
}

/**
 * Reset the singleton client (useful for reconnection or graceful teardown).
 */
async function resetClient() {
  if (_client) {
    try {
      await _client.$disconnect();
    } catch (_) {}
    _client = null;
  }
}

/**
 * A Proxy that lazily resolves the PrismaClient.
 * All service modules can continue to write `prisma.contact.findMany()` etc.
 * without knowing when the client is actually instantiated.
 */
const prisma = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === '$reset') return resetClient;
      const client = getClient();
      const value = client[prop];
      // Bind methods so `this` is the client
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);

module.exports = prisma;

