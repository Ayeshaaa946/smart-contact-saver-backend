const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const upload = require('../middleware/upload');

router.post('/upload', upload.single('file'), importController.uploadFile);
router.post('/:id/preview', importController.preview);
router.post('/:id/confirm', importController.confirmImport);
router.get('/', importController.getImportHistory);
router.get('/:id', importController.getImport);

module.exports = router;
