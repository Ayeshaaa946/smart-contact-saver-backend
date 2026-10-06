const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const {
  mongoIdRules,
  createContactRules,
  updateContactRules,
  paginationRules,
  validate,
} = require('../middleware/validation');

router.get('/search', paginationRules, validate, contactController.searchContacts);
router.get('/duplicates', contactController.getDuplicates);
router.get('/conflicts', paginationRules, validate, contactController.getConflicts);
router.get('/', paginationRules, validate, contactController.listContacts);
router.get('/:id', mongoIdRules, validate, contactController.getContact);
router.post('/', createContactRules, validate, contactController.createContact);
router.put('/:id', updateContactRules, validate, contactController.updateContact);
router.delete('/:id', mongoIdRules, validate, contactController.deleteContact);

module.exports = router;
