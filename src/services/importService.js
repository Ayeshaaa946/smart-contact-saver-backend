const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/db');
const { normalizePhoneNumber } = require('./phoneService');
const { matchContact } = require('./matchingService');
const { logActivity } = require('./activityService');
const { detectColumns } = require('../utils/columnDetector');
const { FileError, ValidationError } = require('../utils/errors');

/**
 * Parse an Excel file (.xlsx or .xls) and return headers + rows.
 */
function parseExcelFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new FileError('File not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    throw new FileError('Unsupported file format. Only .xlsx and .xls are allowed.');
  }

  let workbook;
  try {
    workbook = XLSX.readFile(filePath, { cellFormula: false, cellHTML: false });
  } catch (err) {
    throw new FileError(`Failed to read Excel file: ${err.message}`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new FileError('Excel file has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rawData.length === 0) {
    throw new FileError('Excel file is empty');
  }

  const headers = rawData[0].map((h) => String(h || '').trim());
  const rows = rawData.slice(1).filter((row) => row.some((cell) => cell !== '' && cell != null));

  return {
    headers,
    rows,
    totalRows: rows.length,
    sheetName,
    detectedColumns: detectColumns(headers),
  };
}

/**
 * Preview an import without committing changes.
 * Categorizes each row as: new, existing, duplicate, invalid, conflict.
 */
async function previewImport(importId, parsedData, columnMapping, defaultCountry = 'PK') {
  const { rows } = parsedData;
  const { nameColumn, phoneColumn } = columnMapping;

  if (nameColumn === null || nameColumn === undefined || phoneColumn === null || phoneColumn === undefined) {
    throw new ValidationError('Name and Phone column mapping is required');
  }

  const preview = [];
  const stats = { total: rows.length, new: 0, existing: 0, duplicates: 0, invalid: 0, conflicts: 0 };
  const seenNormalized = new Map(); // track duplicates within this file

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameColumn] || '').trim();
    const rawPhone = String(row[phoneColumn] || '').trim();
    const rowNumber = i + 1;

    if (!name && !rawPhone) {
      continue;
    }

    if (!name) {
      preview.push({
        rowNumber,
        originalName: '',
        originalPhone: rawPhone,
        normalizedPhone: null,
        status: 'invalid',
        reason: 'Name is empty',
      });
      stats.invalid++;
      continue;
    }

    if (!rawPhone) {
      preview.push({
        rowNumber,
        originalName: name,
        originalPhone: '',
        normalizedPhone: null,
        status: 'invalid',
        reason: 'Phone number is empty',
      });
      stats.invalid++;
      continue;
    }

    const phoneResult = normalizePhoneNumber(rawPhone, defaultCountry);

    if (!phoneResult.isValid) {
      preview.push({
        rowNumber,
        originalName: name,
        originalPhone: rawPhone,
        normalizedPhone: null,
        status: 'invalid',
        reason: phoneResult.error || 'Invalid phone number',
      });
      stats.invalid++;
      continue;
    }

    // Check for duplicates within this file
    if (seenNormalized.has(phoneResult.normalizedNumber)) {
      preview.push({
        rowNumber,
        originalName: name,
        originalPhone: rawPhone,
        normalizedPhone: phoneResult.normalizedNumber,
        status: 'duplicate',
        reason: `Duplicate of row ${seenNormalized.get(phoneResult.normalizedNumber)}`,
      });
      stats.duplicates++;
      continue;
    }
    seenNormalized.set(phoneResult.normalizedNumber, rowNumber);

    // Check against database
    const match = await matchContact(name, rawPhone, defaultCountry);

    preview.push({
      rowNumber,
      originalName: name,
      originalPhone: rawPhone,
      normalizedPhone: phoneResult.normalizedNumber,
      status: match.status,
      reason: match.reason,
      existingContact: match.existingContact
        ? { id: match.existingContact.id, name: match.existingContact.name }
        : null,
    });

    stats[match.status === 'conflict' ? 'conflicts' : match.status]++;
  }

  // Update import record with preview stats
  await prisma.import.update({
    where: { id: importId },
    data: {
      totalRows: stats.total,
      newContacts: stats.new,
      existingContacts: stats.existing,
      duplicates: stats.duplicates,
      invalidNumbers: stats.invalid,
      conflicts: stats.conflicts,
      status: 'preview',
      columnMapping: JSON.stringify(columnMapping),
    },
  });

  return { preview, stats };
}

/**
 * Execute a confirmed import, creating contacts and conflict records.
 */
async function executeImport(importId, previewData, defaultCountry = 'PK') {
  const { preview } = previewData;

  await logActivity('import_started', 'import', importId, { totalRows: preview.length });

  let newCount = 0;
  let existingCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let conflictCount = 0;

  for (const row of preview) {
    if (row.status === 'new') {
      // Create new contact with phone number
      const contact = await prisma.contact.create({
        data: {
          name: row.originalName,
          phoneNumbers: {
            create: {
              originalNumber: row.originalPhone,
              normalizedNumber: row.normalizedPhone,
              countryCode: normalizePhoneNumber(row.originalPhone, defaultCountry).countryCode,
              nationalNumber: normalizePhoneNumber(row.originalPhone, defaultCountry).nationalNumber,
              isPrimary: true,
            },
          },
        },
      });

      await prisma.importRecord.create({
        data: {
          importId,
          contactId: contact.id,
          originalName: row.originalName,
          originalPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
          status: 'new',
          reason: row.reason,
          rowNumber: row.rowNumber,
        },
      });

      await logActivity('contact_created', 'contact', contact.id, {
        name: row.originalName,
        phone: row.normalizedPhone,
        source: 'import',
      });

      newCount++;
    } else if (row.status === 'existing') {
      await prisma.importRecord.create({
        data: {
          importId,
          contactId: row.existingContact?.id || null,
          originalName: row.originalName,
          originalPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
          status: 'existing',
          reason: row.reason,
          rowNumber: row.rowNumber,
        },
      });
      existingCount++;
    } else if (row.status === 'duplicate') {
      await prisma.importRecord.create({
        data: {
          importId,
          originalName: row.originalName,
          originalPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
          status: 'duplicate',
          reason: row.reason,
          rowNumber: row.rowNumber,
        },
      });

      await logActivity('duplicate_detected', 'import', importId, {
        phone: row.normalizedPhone,
        row: row.rowNumber,
      });

      duplicateCount++;
    } else if (row.status === 'conflict') {
      await prisma.conflict.create({
        data: {
          importId,
          existingContactId: row.existingContact?.id || null,
          existingName: row.existingContact?.name || '',
          existingPhone: row.normalizedPhone,
          incomingName: row.originalName,
          incomingPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
        },
      });

      await prisma.importRecord.create({
        data: {
          importId,
          contactId: row.existingContact?.id || null,
          originalName: row.originalName,
          originalPhone: row.originalPhone,
          normalizedPhone: row.normalizedPhone,
          status: 'conflict',
          reason: row.reason,
          rowNumber: row.rowNumber,
        },
      });

      await logActivity('conflict_detected', 'import', importId, {
        existingName: row.existingContact?.name,
        incomingName: row.originalName,
        phone: row.normalizedPhone,
      });

      conflictCount++;
    } else if (row.status === 'invalid') {
      await prisma.importRecord.create({
        data: {
          importId,
          originalName: row.originalName || '',
          originalPhone: row.originalPhone || '',
          normalizedPhone: null,
          status: 'invalid',
          reason: row.reason,
          rowNumber: row.rowNumber,
        },
      });
      invalidCount++;
    }
  }

  // Update the import record
  const updatedImport = await prisma.import.update({
    where: { id: importId },
    data: {
      newContacts: newCount,
      existingContacts: existingCount,
      duplicates: duplicateCount,
      invalidNumbers: invalidCount,
      conflicts: conflictCount,
      status: 'completed',
      completedAt: new Date(),
    },
  });

  await logActivity('import_completed', 'import', importId, {
    newContacts: newCount,
    existing: existingCount,
    duplicates: duplicateCount,
    invalid: invalidCount,
    conflicts: conflictCount,
  });

  return updatedImport;
}

module.exports = { parseExcelFile, previewImport, executeImport };
