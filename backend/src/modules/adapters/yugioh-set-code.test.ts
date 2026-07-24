import {
  buildLegacyYugiohSetCode,
  canonicalizeYugiohSetCode,
  extractYugiohCollectorNumber,
  extractYugiohLanguageCode,
  extractYugiohSetPrefix,
  isYugiohSetCodeCompatible,
  normalizeYugiohSetCode,
  parseYugiohSetCode,
  transformYugiohSetCode
} from './yugioh-set-code';

describe('Yu-Gi-Oh set code utilities', () => {
  test.each([
    ['LOB-EN005', { prefix: 'LOB', region: 'EN', suffix: '005' }],
    ['LOB-E001', { prefix: 'LOB', region: 'E', suffix: '001' }],
    ['SDY-006', { prefix: 'SDY', suffix: '006' }],
    ['SGX2-END16', { prefix: 'SGX2', region: 'EN', suffix: 'D16' }],
    ['  ra01-de054 ', { prefix: 'RA01', region: 'DE', suffix: '054' }]
  ])('parses %s', (input, expected) => {
    expect(parseYugiohSetCode(input)).toEqual(expected);
  });

  test.each(['LOB', '-EN001', 'LOB-', '', '  '])('rejects malformed code %p', (input) => {
    expect(parseYugiohSetCode(input)).toBeNull();
  });

  test('prefers a two-letter marker over its one-letter prefix', () => {
    expect(parseYugiohSetCode('LOB-EN001')).toEqual({
      prefix: 'LOB',
      region: 'EN',
      suffix: '001'
    });
  });

  test.each([
    ['SDY-G006', 'SDY-006'],
    ['LOB-EN005', 'LOB-005'],
    ['SDY-006', 'SDY-006'],
    ['SGX2-END16', 'SGX2-D16'],
    [' no-hyphen ', 'NO-HYPHEN']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeYugiohSetCode(input)).toBe(expected);
  });

  test('canonicalizes a code without erasing its language', () => {
    expect(canonicalizeYugiohSetCode(' lob-en001 ')).toBe('LOB-EN001');
  });

  test.each([
    ['LOB-EN001', 'de', 'LOB-DE001'],
    ['LOB-E001', 'DE', 'LOB-G001'],
    ['LOB-G001', 'en', 'LOB-E001'],
    ['RA01-EN054', 'zh', 'RA01-ZH054'],
    ['SDY-006', 'DE', 'SDY-006']
  ])('transforms %s to %s as %s', (input, language, expected) => {
    expect(transformYugiohSetCode(input, language)).toBe(expected);
  });

  test('leaves a code unchanged when the target language is unknown', () => {
    expect(transformYugiohSetCode('LOB-EN001', 'xx')).toBe('LOB-EN001');
  });

  test.each([
    ['LOB-EN001', 'EN'],
    ['LOB-E001', 'EN'],
    ['LOB-G001', 'DE'],
    ['LOB-AE001', 'EN'],
    ['LOB-TC001', 'ZH'],
    ['LOB-SC001', 'ZH'],
    ['SDY-006', 'EN']
  ])('extracts %s from %s', (input, expected) => {
    expect(extractYugiohLanguageCode(input)).toBe(expected);
  });

  test.each([
    ['SDY-006', 'DE', true],
    ['LOB-DE001', 'DE', true],
    ['LOB-G001', 'de', true],
    ['LOB-EN001', 'DE', false],
    ['LOB-TC001', 'ZH', true],
    ['LOB-TC001', 'CN', true],
    ['LOB-EN001', 'unknown', false],
    ['not-a-code', 'DE', true]
  ])('compatibility of %s with %s is %s', (setCode, language, expected) => {
    expect(isYugiohSetCodeCompatible(setCode, language)).toBe(expected);
  });

  test.each([
    ['LOB', '020', 'DE', 'LOB-G020'],
    ['lob', '020', 'gb', 'LOB-E020'],
    ['LOB', '020', 'ZH', null],
    ['LOB', '020', 'unknown', null]
  ])('builds legacy code for %s/%s/%s', (prefix, number, language, expected) => {
    expect(buildLegacyYugiohSetCode(prefix, number, language)).toBe(expected);
  });

  test('extracts prefix and collector number', () => {
    expect(extractYugiohSetPrefix('SGX2-END16')).toBe('SGX2');
    expect(extractYugiohCollectorNumber('SGX2-END16')).toBe('D16');
  });
});
