const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Pre-clean a raw phone string before parsing:
 * removes parentheses, extra spaces, dashes, dots, and leading/trailing whitespace.
 */
function preclean(raw) {
  if (!raw) return '';
  let cleaned = String(raw).trim();
  // Remove parentheses
  cleaned = cleaned.replace(/[()]/g, '');
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

/**
 * Normalize a phone number to E.164 format.
 *
 * @param {string} rawNumber - The raw phone number input
 * @param {string} defaultCountry - ISO country code (default: 'PK')
 * @returns {object} { isValid, originalNumber, normalizedNumber, countryCode, nationalNumber, internationalFormat, error }
 */
function normalizePhoneNumber(rawNumber, defaultCountry = 'PK') {
  const result = {
    isValid: false,
    originalNumber: rawNumber,
    normalizedNumber: null,
    countryCode: null,
    nationalNumber: null,
    internationalFormat: null,
    error: null,
  };

  if (!rawNumber || String(rawNumber).trim() === '') {
    result.error = 'Phone number is empty';
    return result;
  }

  const cleaned = preclean(rawNumber);

  // Try parsing directly with the default country
  let phone = parsePhoneNumberFromString(cleaned, defaultCountry);

  // If that fails, try some common transformations for Pakistani numbers
  if (!phone || !phone.isValid()) {
    // Strip all non-digit and non-plus characters for fallback attempts
    const digitsOnly = cleaned.replace(/[^\d+]/g, '');

    // Pakistani local format: starts with 0, e.g. 03001234567
    if (defaultCountry === 'PK' && /^0[3-9]\d{9}$/.test(digitsOnly)) {
      phone = parsePhoneNumberFromString('+92' + digitsOnly.slice(1), defaultCountry);
    }
    // Starts with country code without +, e.g. 923001234567
    else if (/^92[3-9]\d{9}$/.test(digitsOnly)) {
      phone = parsePhoneNumberFromString('+' + digitsOnly, defaultCountry);
    }
    // Generic: try with + prefix if it looks like a country code number
    else if (/^\d{10,15}$/.test(digitsOnly) && !digitsOnly.startsWith('0')) {
      phone = parsePhoneNumberFromString('+' + digitsOnly);
    }

    // Final fallback: try parsing the digits-only version
    if (!phone || !phone.isValid()) {
      phone = parsePhoneNumberFromString(digitsOnly, defaultCountry);
    }
  }

  if (phone && phone.isValid()) {
    result.isValid = true;
    result.normalizedNumber = phone.format('E.164');
    result.countryCode = phone.country || null;
    result.nationalNumber = phone.nationalNumber || null;
    result.internationalFormat = phone.formatInternational();
  } else {
    result.error = 'Invalid phone number';
  }

  return result;
}

/**
 * Check if two phone numbers are the same after normalization.
 */
function areNumbersEqual(number1, number2, defaultCountry = 'PK') {
  const n1 = normalizePhoneNumber(number1, defaultCountry);
  const n2 = normalizePhoneNumber(number2, defaultCountry);

  if (!n1.isValid || !n2.isValid) return false;
  return n1.normalizedNumber === n2.normalizedNumber;
}

/**
 * Format a phone number for display.
 */
function formatPhoneNumber(number, format = 'international', defaultCountry = 'PK') {
  const phone = parsePhoneNumberFromString(preclean(number), defaultCountry);
  if (!phone) return number;

  switch (format) {
    case 'international':
      return phone.formatInternational();
    case 'national':
      return phone.formatNational();
    case 'e164':
      return phone.format('E.164');
    default:
      return phone.formatInternational();
  }
}

/**
 * Detect the country of a phone number.
 */
function detectCountry(number, defaultCountry = 'PK') {
  const result = normalizePhoneNumber(number, defaultCountry);
  return result.countryCode || null;
}

/**
 * Normalize a batch of phone numbers.
 */
function batchNormalize(numbers, defaultCountry = 'PK') {
  if (!Array.isArray(numbers)) return [];
  return numbers.map((num) => normalizePhoneNumber(num, defaultCountry));
}

module.exports = {
  normalizePhoneNumber,
  areNumbersEqual,
  formatPhoneNumber,
  detectCountry,
  batchNormalize,
};
