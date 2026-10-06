const prisma = require('../config/db');
const { success } = require('../utils/apiResponse');

async function getStats(req, res, next) {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      activeContacts,
      totalImports,
      pendingConflicts,
      totalPhoneNumbers,
      recentImports,
      invalidCount,
      duplicateCount,
      newThisMonth,
    ] = await Promise.all([
      prisma.contact.count({ where: { status: 'active' } }).catch(() => 0),
      prisma.import.count().catch(() => 0),
      prisma.conflict.count({ where: { resolution: 'pending' } }).catch(() => 0),
      prisma.phoneNumber.count().catch(() => 0),
      prisma.import.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
      }).catch(() => []),
      prisma.importRecord.count({ where: { status: 'invalid' } }).catch(() => 0),
      prisma.importRecord.count({ where: { status: 'duplicate' } }).catch(() => 0),
      prisma.contact.count({
        where: {
          createdAt: { gte: startOfMonth },
          status: 'active',
        },
      }).catch(() => 0),
    ]);

    return success(res, {
      totalContacts: activeContacts || 0,
      newThisMonth: newThisMonth || 0,
      totalImports: totalImports || 0,
      pendingConflicts: pendingConflicts || 0,
      totalPhoneNumbers: totalPhoneNumbers || 0,
      invalidNumbers: invalidCount || 0,
      duplicatesFound: duplicateCount || 0,
      recentImports: recentImports || [],
    });
  } catch (err) {
    return success(res, {
      totalContacts: 0,
      newThisMonth: 0,
      totalImports: 0,
      pendingConflicts: 0,
      totalPhoneNumbers: 0,
      invalidNumbers: 0,
      duplicatesFound: 0,
      recentImports: [],
    });
  }
}

module.exports = { getStats };
