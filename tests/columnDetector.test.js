const { detectColumns } = require('../src/utils/columnDetector');

describe('Column Detector Utility', () => {
  test('detects Name and Phone headers accurately', () => {
    const headers = ['Full Name', 'Mobile Number', 'Email Address', 'Company'];
    const detected = detectColumns(headers);

    expect(detected.nameColumn).toBe(0);
    expect(detected.phoneColumn).toBe(1);
  });

  test('detects alternate header variations', () => {
    const headers = ['Address', 'Contact No', 'Customer Name'];
    const detected = detectColumns(headers);

    expect(detected.phoneColumn).toBe(1);
    expect(detected.nameColumn).toBe(2);
  });

  test('returns null when header not recognized', () => {
    const headers = ['ID', 'Score', 'Department'];
    const detected = detectColumns(headers);

    expect(detected.nameColumn).toBeNull();
    expect(detected.phoneColumn).toBeNull();
  });
});
