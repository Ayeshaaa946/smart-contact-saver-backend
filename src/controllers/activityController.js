const { getActivities, getRecentActivities } = require('../services/activityService');
const { success, paginated } = require('../utils/apiResponse');

async function list(req, res, next) {
  try {
    const { page = 1, limit = 20, action, entityType } = req.query;
    const result = await getActivities({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      action,
      entityType,
    });
    return paginated(res, result.activities, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}

async function recent(req, res, next) {
  try {
    const { limit = 10 } = req.query;
    const activities = await getRecentActivities(parseInt(limit, 10)).catch(() => []);
    return success(res, activities || []);
  } catch (err) {
    return success(res, []);
  }
}

module.exports = { list, recent };
