const NAME_PATTERNS = [
  { pattern: /^name$/i, confidence: 'high' },
  { pattern: /^full[\s_-]?name$/i, confidence: 'high' },
  { pattern: /^contact[\s_-]?name$/i, confidence: 'high' },
  { pattern: /^customer[\s_-]?name$/i, confidence: 'high' },
  { pattern: /^person[\s_-]?name$/i, confidence: 'high' },
  { pattern: /^first[\s_-]?name$/i, confidence: 'medium' },
  { pattern: /^last[\s_-]?name$/i, confidence: 'medium' },
  { pattern: /^person$/i, confidence: 'medium' },
  { pattern: /^display[\s_-]?name$/i, confidence: 'medium' },
  { pattern: /^\u0646\u0627\u0645$/i, confidence: 'high' },
  { pattern: /name/i, confidence: 'low' },
];

const PHONE_PATTERNS = [
  { pattern: /^phone$/i, confidence: 'high' },
  { pattern: /^mobile$/i, confidence: 'high' },
  { pattern: /^phone[\s_-]?number$/i, confidence: 'high' },
  { pattern: /^mobile[\s_-]?number$/i, confidence: 'high' },
  { pattern: /^contact[\s_-]?(?:no|num|number)$/i, confidence: 'high' },
  { pattern: /^cell$/i, confidence: 'high' },
  { pattern: /^cell[\s_-]?number$/i, confidence: 'high' },
  { pattern: /^telephone$/i, confidence: 'high' },
  { pattern: /^tel$/i, confidence: 'high' },
  { pattern: /^number$/i, confidence: 'medium' },
  { pattern: /^\u0641\u0648\u0646$/i, confidence: 'high' },
  { pattern: /^\u0646\u0645\u0628\u0631$/i, confidence: 'high' },
  { pattern: /phone|mobile|cell|tel|contact/i, confidence: 'low' },
];

function detectColumns(headers) {
  if (!headers || !Array.isArray(headers) || headers.length === 0) {
    return { nameColumn: null, phoneColumn: null, confidence: 'low', allHeaders: [] };
  }

  const cleanHeaders = headers.map((h) => (h ? String(h).trim() : ''));

  let nameColumn = null;
  let phoneColumn = null;
  let nameConfidence = null;
  let phoneConfidence = null;

  const confidenceRank = { high: 3, medium: 2, low: 1 };

  for (let i = 0; i < cleanHeaders.length; i++) {
    const header = cleanHeaders[i];
    if (!header) continue;

    for (const { pattern, confidence } of NAME_PATTERNS) {
      if (pattern.test(header)) {
        if (!nameConfidence || confidenceRank[confidence] > confidenceRank[nameConfidence]) {
          nameColumn = i;
          nameConfidence = confidence;
        }
        break;
      }
    }

    for (const { pattern, confidence } of PHONE_PATTERNS) {
      if (pattern.test(header)) {
        if (!phoneConfidence || confidenceRank[confidence] > confidenceRank[phoneConfidence]) {
          phoneColumn = i;
          phoneConfidence = confidence;
        }
        break;
      }
    }
  }

  let overallConfidence = 'low';
  if (nameConfidence === 'high' && phoneConfidence === 'high') {
    overallConfidence = 'high';
  } else if (nameConfidence && phoneConfidence) {
    overallConfidence = 'medium';
  }

  return {
    nameColumn,
    phoneColumn,
    confidence: overallConfidence,
    allHeaders: cleanHeaders,
  };
}

module.exports = { detectColumns };
