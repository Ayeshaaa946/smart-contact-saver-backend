const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

router.get('/', messageController.listMessages);
router.get('/recent', messageController.listMessages);
router.get('/unknown', messageController.getUnknownSenders);
router.post('/save-unknown', messageController.saveUnknownSender);

module.exports = router;
