const contactService = require('../services/contactService');
const { success, paginated } = require('../utils/apiResponse');

async function listContacts(req, res, next) {
  try {
    const { page = 1, limit = 20, search = '', status = 'active', sortBy = 'name', sortOrder = 'asc' } = req.query;
    const result = await contactService.listContacts({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      status,
      sortBy,
      sortOrder,
    });
    return paginated(res, result.contacts, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}

async function getContact(req, res, next) {
  try {
    const contact = await contactService.getContact(req.params.id);
    return success(res, contact);
  } catch (err) {
    next(err);
  }
}

async function createContact(req, res, next) {
  try {
    const contact = await contactService.createContact(req.body);
    return success(res, contact, 201);
  } catch (err) {
    next(err);
  }
}

async function updateContact(req, res, next) {
  try {
    const contact = await contactService.updateContact(req.params.id, req.body);
    return success(res, contact);
  } catch (err) {
    next(err);
  }
}

async function deleteContact(req, res, next) {
  try {
    await contactService.deleteContact(req.params.id);
    return success(res, { message: 'Contact deleted successfully' });
  } catch (err) {
    next(err);
  }
}

async function searchContacts(req, res, next) {
  try {
    const { q = '', page = 1, limit = 20 } = req.query;
    const result = await contactService.searchContacts(q, {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    return paginated(res, result.contacts, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}

async function getDuplicates(req, res, next) {
  try {
    const duplicates = await contactService.getDuplicates();
    return success(res, duplicates);
  } catch (err) {
    next(err);
  }
}

async function getConflicts(req, res, next) {
  try {
    const { resolution, page = 1, limit = 20 } = req.query;
    const result = await contactService.getConflicts({
      resolution,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
    return paginated(res, result.conflicts, result.total, result.page, result.limit);
  } catch (err) {
    next(err);
  }
}

async function resolveConflict(req, res, next) {
  try {
    const { resolution } = req.body;
    const conflict = await contactService.resolveConflict(req.params.id, resolution);
    return success(res, conflict);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  searchContacts,
  getDuplicates,
  getConflicts,
  resolveConflict,
};
