/**
 * Test fixtures for Nimiq addresses
 */

// Valid Nimiq addresses for testing
export const validAddresses = {
  // Standard format with spaces
  basic: 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
  // No spaces (raw format)
  noSpaces: 'NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19',
  // Lowercase (should be normalized to uppercase)
  lowercase: 'nq15 mljn 23yb 8fbm 61tn 7lyg 2212 lvbg 4v19',
  // Mixed case
  mixedCase: 'Nq15 MlJn 23Yb 8FbM 61Tn 7LyG 2212 LvBg 4V19',
  // Realistic looking addresses
  address1: 'NQ09 VF5Y 1PKV MRM4 5LE1 55KV P6R2 GXYJ XYQF',
  address2: 'NQ34 NT7S G97J EGA1 C0RM 0JT2 NX5S VL9S JVKR',
  address3: 'NQ55 H5H1 2AG5 XGSC L5NE 8U5E GF24 15SB GFEM',
};

// Invalid Nimiq addresses for testing
export const invalidAddresses = {
  // Wrong prefix
  wrongPrefix: 'BQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
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
  noPrefix: '15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
  // Wrong checksum format (NQ followed by letters instead of digits)
  wrongChecksum: 'NQAB XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX',
  // Contains O (not allowed in Nimiq addresses, uses 0)
  containsO: 'NQ15 MLOJ 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
  // Contains I (not allowed in Nimiq addresses, uses 1)
  containsI: 'NQ15 MLIJ 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
};

// Pairs for testing path finding
export const addressPairs = {
  // Direct connection test
  directConnection: {
    from: 'NQ09 VF5Y 1PKV MRM4 5LE1 55KV P6R2 GXYJ XYQF',
    to: 'NQ34 NT7S G97J EGA1 C0RM 0JT2 NX5S VL9S JVKR',
  },
  // Multi-hop path test
  multiHop: {
    from: 'NQ55 H5H1 2AG5 XGSC L5NE 8U5E GF24 15SB GFEM',
    to: 'NQ31 FVDG LE5U 9RC9 77KQ EAN5 YP9V G999 X535',
    intermediate: [
      'NQ69 GTPG 0RCT GR2S E90G 60EV X65X H2KH BQLL',
      'NQ35 YGH5 41TT R77B 61S6 UP7L XC0M S0D2 GDFL',
    ],
  },
};

// Formatted addresses for testing truncation
export const truncatedAddresses = {
  input: 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19',
  expected: 'NQ15...4V19',
  short: 'NQ15 MLJN', // Should not be truncated
};
