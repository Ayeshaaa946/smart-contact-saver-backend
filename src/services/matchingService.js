const prisma = require('../config/db');
const { normalizePhoneNumber } = require('./phoneService');

/**
 * Match a contact by phone number.
 * Returns: { status, normalizedPhone, existingContact, reason }
 * Statuses: 'new', 'existing', 'conflict', 'invalid'
 */
async function matchContact(name, rawPhone, defaultCountry = 'PK') {
  const phoneResult = normalizePhoneNumber(rawPhone, defaultCountry);

  if (!phoneResult.isValid) {
    return {
      status: 'invalid',
      normalizedPhone: null,
      existingContact: null,
      reason: phoneResult.error || 'Invalid phone number',
      phoneResult,
    };
  }

  const existingPhone = await prisma.phoneNumber.findUnique({
    where: { normalizedNumber: phoneResult.normalizedNumber },
    include: {
      contact: {
        include: { phoneNumbers: true },
      },
    },
  });

  if (!existingPhone) {
    return {
      status: 'new',
      normalizedPhone: phoneResult.normalizedNumber,
      existingContact: null,
      reason: 'New contact - phone number not found in database',
      phoneResult,
    };
  }

  const existingName = existingPhone.contact.name.trim().toLowerCase();
  const incomingName = (name || '').trim().toLowerCase();

  if (existingName === incomingName) {
    return {
      status: 'existing',
      normalizedPhone: phoneResult.normalizedNumber,
      existingContact: existingPhone.contact,
      reason: `Contact already exists: "${existingPhone.contact.name}"`,
      phoneResult,
    };
  }

  return {
    status: 'conflict',
    normalizedPhone: phoneResult.normalizedNumber,
    existingContact: existingPhone.contact,
    reason: `Name conflict: existing "${existingPhone.contact.name}" vs incoming "${name}"`,
    phoneResult,
  };
}

/**
 * Find duplicate phone numbers within a batch of rows (same normalized number appearing multiple times).
 */
function findDuplicatesInBatch(rows, phoneColumnIndex, defaultCountry = 'PK') {
  const seen = new Map();
  const duplicates = [];

  for (let i = 0; i < rows.length; i++) {
    const rawPhone = rows[i][phoneColumnIndex];
    const result = normalizePhoneNumber(String(rawPhone || ''), defaultCountry);

    if (result.isValid) {
      if (seen.has(result.normalizedNumber)) {
        duplicates.push({
          rowNumber: i + 1,
          originalPhone: rawPhone,
          normalizedPhone: result.normalizedNumber,
          firstOccurrence: seen.get(result.normalizedNumber),
        });
      } else {
        seen.set(result.normalizedNumber, i + 1);
      }
    }
  }

  return duplicates;
}

module.exports = { matchContact, findDuplicatesInBatch };
