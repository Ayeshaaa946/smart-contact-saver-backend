const prisma = require('../config/db');
const { parseExcelFile, previewImport, executeImport } = require('../services/importService');
const { success, paginated } = require('../utils/apiResponse');
const { NotFoundError, ValidationError } = require('../utils/errors');

async function uploadFile(req, res, next) {
  try {
    if (!req.file) {
      throw new ValidationError('No file uploaded');
    }

    const parsed = parseExcelFile(req.file.path);

    // Create import record
    const importRecord = await prisma.import.create({
      data: {
        fileName: req.file.filename,
        originalName: req.file.originalname,
        totalRows: parsed.totalRows,
        status: 'pending',
      },
    });

    return success(res, {
      importId: importRecord.id,
      fileName: req.file.originalname,
      headers: parsed.headers,
      totalRows: parsed.totalRows,
      sheetName: parsed.sheetName,
      detectedColumns: parsed.detectedColumns,
      sampleRows: parsed.rows.slice(0, 5),
    }, 201);
  } catch (err) {
    next(err);
  }
}

async function preview(req, res, next) {
  try {
    const importRecord = await prisma.import.findUnique({ where: { id: req.params.id } });
    if (!importRecord) throw new NotFoundError('Import');

    const { nameColumn, phoneColumn } = req.body;
    if (nameColumn === undefined || phoneColumn === undefined) {
      throw new ValidationError('nameColumn and phoneColumn are required');
    }

    const filePath = require('path').join(require('../config').uploadDir, importRecord.fileName);
    const parsed = parseExcelFile(filePath);

    const result = await previewImport(
      importRecord.id,
      parsed,
      { nameColumn: parseInt(nameColumn, 10), phoneColumn: parseInt(phoneColumn, 10) }
    );

    return success(res, result);
  } catch (err) {
    next(err);
  }
}

async function confirmImport(req, res, next) {
  try {
    const importRecord = await prisma.import.findUnique({ where: { id: req.params.id } });
    if (!importRecord) throw new NotFoundError('Import');

    if (importRecord.status !== 'preview') {
      throw new ValidationError('Import must be previewed before confirming');
    }

    // Re-run preview to get current data
    const filePath = require('path').join(require('../config').uploadDir, importRecord.fileName);
    const parsed = parseExcelFile(filePath);
    const columnMapping = JSON.parse(importRecord.columnMapping);

    const previewResult = await previewImport(importRecord.id, parsed, columnMapping);
    const result = await executeImport(importRecord.id, previewResult);

    return success(res, result);
  } catch (err) {
    next(err);
  }
}

async function getImportHistory(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [imports, total] = await Promise.all([
      prisma.import.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
      }),
      prisma.import.count(),
    ]);

    return paginated(res, imports, total, parseInt(page, 10), parseInt(limit, 10));
  } catch (err) {
    next(err);
  }
}

async function getImport(req, res, next) {
  try {
    const importRecord = await prisma.import.findUnique({
      where: { id: req.params.id },
      include: {
        records: {
          orderBy: { rowNumber: 'asc' },
        },
        conflictRecords: true,
      },
    });

    if (!importRecord) throw new NotFoundError('Import');
    return success(res, importRecord);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  uploadFile,
  preview,
  confirmImport,
  getImportHistory,
  getImport,
};
