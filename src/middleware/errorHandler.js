function sanitizeErrorText(text) {
  return String(text || '')
    .replace(/(mongodb(\+srv)?|postgres|mysql):\/\/[^\s]+/gi, '[REDACTED_URI]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/META_[A-Z0-9_]+/g, '[REDACTED_ENV]');
}

function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  // Internal logging (never leak credentials/tokens in logs)
  const sanitizedMessage = sanitizeErrorText(err.message);
  console.error(`[API Error] ${req.method} ${req.originalUrl}:`, sanitizedMessage);

  // Custom operational errors
  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({
      success: false,
      error: {
        message: err.message,
        code: err.code || 'OPERATIONAL_ERROR',
        details: err.details || null,
      },
    });
  }

  // Handle Prisma Duplicate Key Errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        message: 'A record with this value already exists',
        code: 'DUPLICATE_ENTRY',
      },
    });
  }

  // Handle Prisma Not Found Errors
  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        message: 'Resource not found',
        code: 'NOT_FOUND',
      },
    });
  }

  // Handle express-validator errors
  if (err.array && typeof err.array === 'function') {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.array().map((e) => ({ field: e.path, message: e.msg })),
      },
    });
  }

  // Handle Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: {
        message: 'File is too large. Maximum size is 10MB.',
        code: 'FILE_TOO_LARGE',
      },
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Unexpected file field',
        code: 'UNEXPECTED_FILE',
      },
    });
  }

  // Handle Prisma Database Connection / Initialization Errors
  if (
    err.name === 'PrismaClientInitializationError' ||
    err.name === 'PrismaClientRustPanicError' ||
    err.message?.includes('Can\'t reach database server') ||
    err.message?.includes('database server') ||
    err.message?.includes('DATABASE_URL') ||
    err.message?.includes('timed out') ||
    err.message?.includes('Authentication failed') ||
    err.code === 'P1001' ||
    err.code === 'P1000' ||
    err.code === 'P1017'
  ) {
    return res.status(503).json({
      success: false,
      error: {
        message: 'Database connection unavailable. Please ensure MongoDB Atlas IP Access List allows access (0.0.0.0/0) and DATABASE_URL is correctly set in Railway.',
        code: 'DATABASE_UNAVAILABLE',
        details: isDev ? sanitizedMessage : null,
      },
    });
  }

  // Default 500 Internal Error (Never expose stack traces or internal DB paths in non-dev modes)
  return res.status(500).json({
    success: false,
    error: {
      message: isDev ? sanitizedMessage : 'An internal server error occurred. Please try again.',
      code: 'INTERNAL_ERROR',
    },
  });
}

module.exports = errorHandler;
