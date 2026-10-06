const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Integration status (booleans only — never exposes tokens/secrets)
router.get('/status', whatsappController.getStatus);

// Configuration management (editable values and save)
router.get('/config', whatsappController.getConfig);
router.post('/config', whatsappController.saveConfig);

// Live-verify official Meta Cloud API credentials (Graph API)
router.post('/connect', whatsappController.connectOfficialApi);

// Official Meta WhatsApp Cloud API webhook
router.get('/webhook', whatsappController.verifyWebhook); // subscription challenge
router.post('/webhook', whatsappController.handleWebhook); // signed events

// Development simulation test endpoint
router.post('/dev/test-message', whatsappController.devTestMessage);

module.exports = router;