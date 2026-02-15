import { describe, test, expect } from 'bun:test';
import { isValidNimiqAddress, formatAddress, truncateAddress } from './address-utils';
import { validAddresses, invalidAddresses } from '../test/fixtures/addresses';

describe('address-utils', () => {
  describe('isValidNimiqAddress', () => {
    test('accepts valid address with spaces', () => {
      expect(isValidNimiqAddress(validAddresses.basic)).toBe(true);
    });

    test('accepts valid address without spaces', () => {
      expect(isValidNimiqAddress(validAddresses.noSpaces)).toBe(true);
    });

    test('accepts lowercase address', () => {
      expect(isValidNimiqAddress(validAddresses.lowercase)).toBe(true);
    });

    test('accepts mixed case address', () => {
      expect(isValidNimiqAddress(validAddresses.mixedCase)).toBe(true);
    });

    test('accepts realistic addresses', () => {
      expect(isValidNimiqAddress(validAddresses.address1)).toBe(true);
      expect(isValidNimiqAddress(validAddresses.address2)).toBe(true);
      expect(isValidNimiqAddress(validAddresses.address3)).toBe(true);
    });

    test('rejects address with wrong prefix', () => {
      expect(isValidNimiqAddress(invalidAddresses.wrongPrefix)).toBe(false);
    });

    test('rejects address that is too short', () => {
      expect(isValidNimiqAddress(invalidAddresses.tooShort)).toBe(false);
    });

    test('rejects address that is too long', () => {
      expect(isValidNimiqAddress(invalidAddresses.tooLong)).toBe(false);
    });

    test('rejects address with invalid characters', () => {
      expect(isValidNimiqAddress(invalidAddresses.invalidChars)).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidNimiqAddress(invalidAddresses.empty)).toBe(false);
    });

    test('rejects whitespace only', () => {
      expect(isValidNimiqAddress(invalidAddresses.whitespace)).toBe(false);
    });

    test('rejects address without NQ prefix', () => {
      expect(isValidNimiqAddress(invalidAddresses.noPrefix)).toBe(false);
    });

    test('rejects address with wrong checksum format', () => {
      expect(isValidNimiqAddress(invalidAddresses.wrongChecksum)).toBe(false);
    });

    test('rejects checksum-invalid addresses even when structure looks valid', () => {
      expect(isValidNimiqAddress('NQ00 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA')).toBe(false);
    });
  });

  describe('formatAddress', () => {
    test('formats address with correct spacing', () => {
      const formatted = formatAddress(validAddresses.noSpaces);
      expect(formatted).toBe(validAddresses.basic);
    });

    test('normalizes lowercase to uppercase', () => {
      const formatted = formatAddress(validAddresses.lowercase);
      expect(formatted).toBe(validAddresses.basic);
    });

    test('normalizes mixed case to uppercase', () => {
      const formatted = formatAddress(validAddresses.mixedCase);
      expect(formatted).toBe(validAddresses.basic);
    });

    test('preserves already formatted address', () => {
      const formatted = formatAddress(validAddresses.basic);
      expect(formatted).toBe(validAddresses.basic);
    });

    test('handles address with irregular spacing', () => {
      const irregular = 'NQ15  MLJN   23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      const formatted = formatAddress(irregular);
      expect(formatted).toBe(validAddresses.basic);
    });

    test('handles empty string', () => {
      const formatted = formatAddress('');
      expect(formatted).toBe('');
    });
  });

  describe('truncateAddress', () => {
    test('truncates long address correctly', () => {
      const address = validAddresses.basic;
      const truncated = truncateAddress(address);
      expect(truncated).toBe('NQ15...4V19');
    });

    test('does not truncate short address', () => {
      const shortAddr = 'NQ15 MLJN';
      const truncated = truncateAddress(shortAddr);
      expect(truncated).toBe('NQ15 MLJN');
    });

    test('handles exactly 11 character address', () => {
      const addr = '12345678901';
      const truncated = truncateAddress(addr);
      expect(truncated).toBe('12345678901');
    });

    test('handles 12 character address (boundary)', () => {
      const addr = '123456789012';
      const truncated = truncateAddress(addr);
      expect(truncated).toBe('1234...9012');
    });

    test('handles empty string', () => {
      const truncated = truncateAddress('');
      expect(truncated).toBe('');
    });
  });
});
