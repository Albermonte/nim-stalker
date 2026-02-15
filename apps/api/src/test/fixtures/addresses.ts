/**
 * Test fixtures for Nimiq addresses
 */

// Valid Nimiq addresses for testing
export const validAddresses = {
  // Standard format with spaces
  basic: 'NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // No spaces (raw format)
  noSpaces: 'NQ42XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  // Lowercase (should be normalized to uppercase)
  lowercase: 'nq42 xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx',
  // Mixed case
  mixedCase: 'Nq42 XxXx XxXx XxXx XxXx XxXx XxXx XxXx XxXx',
  // Realistic looking addresses
  address1: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
  address2: 'NQ99 ABCD EFGH 1234 5678 KLMN PQRS TUVW XYZ0',
  address3: 'NQ15 B3RU YMHH FBE4 J1TH Y6EV 6FEE 2H2D X5CC',
};

// Invalid Nimiq addresses for testing
export const invalidAddresses = {
  // Wrong prefix
  wrongPrefix: 'BQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Too short
  tooShort: 'NQ42 XXXX',
  // Too long
  tooLong: 'NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Invalid characters (special characters)
  invalidChars: 'NQ42 !!!! @@@@ #### $$$$ %%%% ^^^^ &&&& ****',
  // Empty string
  empty: '',
  // Only whitespace
  whitespace: '    ',
  // Missing NQ prefix
  noPrefix: '42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Wrong checksum format (NQ followed by letters instead of digits)
  wrongChecksum: 'NQAB XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Contains O (not allowed in Nimiq addresses, uses 0)
  containsO: 'NQ42 XXOX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Contains I (not allowed in Nimiq addresses, uses 1)
  containsI: 'NQ42 XXIX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
};

// Pairs for testing path finding
export const addressPairs = {
  // Direct connection test
  directConnection: {
    from: 'NQ42 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA',
    to: 'NQ42 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB',
  },
  // Multi-hop path test
  multiHop: {
    from: 'NQ42 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC',
    to: 'NQ42 FFFF FFFF FFFF FFFF FFFF FFFF FFFF FFFF',
    intermediate: [
      'NQ42 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD',
      'NQ42 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE',
    ],
  },
};

// Formatted addresses for testing truncation
export const truncatedAddresses = {
  input: 'NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  expected: 'NQ42 XXX...XXXX',
  short: 'NQ42 XXXX', // Should not be truncated
};
