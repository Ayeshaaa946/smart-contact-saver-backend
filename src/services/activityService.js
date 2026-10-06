const prisma = require('../config/db');

/**
 * Log an activity event.
 */
async function logActivity(action, entityType = null, entityId = null, details = null) {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        entityType,
        entityId,
        details: details ? JSON.stringify(details) : null,
      },
    });
  } catch (err) {
    console.error('Failed to log activity:', err.message);
  }
}

/**
 * Get activities with pagination and optional filters.
 */
async function getActivities({ page = 1, limit = 20, action = null, entityType = null } = {}) {
  const where = {};
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;

  const [activities, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return { activities, total, page, limit };
}

/**
 * Get recent activities.
 */
async function getRecentActivities(limit = 10) {
  return prisma.activityLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

module.exports = { logActivity, getActivities, getRecentActivities };
