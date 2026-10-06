const {
  normalizePhoneNumber,
  areNumbersEqual,
  formatPhoneNumber,
  detectCountry,
  batchNormalize,
} = require('../src/services/phoneService');

describe('Phone Number Normalization Service', () => {
  const defaultCountry = 'PK';

  test('normalizes Pakistani local 11-digit numbers starting with 0', () => {
    const res = normalizePhoneNumber('03001234567', defaultCountry);
    expect(res.isValid).toBe(true);
    expect(res.normalizedNumber).toBe('+923001234567');
    expect(res.countryCode).toBe('PK');
  });

  test('normalizes Pakistani E.164 formatted numbers', () => {
    const res = normalizePhoneNumber('+923001234567', defaultCountry);
    expect(res.isValid).toBe(true);
    expect(res.normalizedNumber).toBe('+923001234567');
  });

  test('normalizes Pakistani numbers with country code without plus sign', () => {
    const res = normalizePhoneNumber('923001234567', defaultCountry);
    expect(res.isValid).toBe(true);
    expect(res.normalizedNumber).toBe('+923001234567');
  });

  test('normalizes formatted numbers with spaces, dashes, and parentheses', () => {
    const numbersToTest = [
      '+92 300 1234567',
      '+92-300-1234567',
      '0300-1234567',
      '0300 1234567',
      '(0300) 1234567',
    ];

    for (const num of numbersToTest) {
      const res = normalizePhoneNumber(num, defaultCountry);
      expect(res.isValid).toBe(true);
      expect(res.normalizedNumber).toBe('+923001234567');
    }
  });

  test('compares equivalence of different phone string representations', () => {
    const isSame = areNumbersEqual('03001234567', '+92 300 1234567', defaultCountry);
    expect(isSame).toBe(true);
  });

  test('rejects empty or invalid phone numbers', () => {
    expect(normalizePhoneNumber('', defaultCountry).isValid).toBe(false);
    expect(normalizePhoneNumber('invalid-text', defaultCountry).isValid).toBe(false);
    expect(normalizePhoneNumber('123', defaultCountry).isValid).toBe(false);
  });

  test('batchNormalizes multiple numbers', () => {
    const batch = ['03001234567', '+923129876543'];
    const results = batchNormalize(batch, defaultCountry);
    expect(results).toHaveLength(2);
    expect(results[0].normalizedNumber).toBe('+923001234567');
    expect(results[1].normalizedNumber).toBe('+923129876543');
  });
});
