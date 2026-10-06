const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activityController');
const { paginationRules, validate } = require('../middleware/validation');

router.get('/recent', activityController.recent);
router.get('/', paginationRules, validate, activityController.list);

module.exports = router;
