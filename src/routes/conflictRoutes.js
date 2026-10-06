const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { paginationRules, validate } = require('../middleware/validation');

router.get('/', paginationRules, validate, contactController.getConflicts);
router.post('/:id/resolve', contactController.resolveConflict);

module.exports = router;
