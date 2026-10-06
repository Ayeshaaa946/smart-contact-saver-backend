const messageService = require('../services/messageService');
const { success, paginated } = require('../utils/apiResponse');

async function listMessages(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await messageService.getRecentMessages({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    return paginated(res, result.messages, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}

async function getUnknownSenders(req, res, next) {
  try {
    const unknownList = await messageService.getUnknownSenders();
    return success(res, unknownList);
  } catch (err) {
    next(err);
  }
}

async function saveUnknownSender(req, res, next) {
  try {
    const contact = await messageService.saveUnknownSender(req.body);
    return success(res, contact, 201);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMessages,
  getUnknownSenders,
  saveUnknownSender,
};
