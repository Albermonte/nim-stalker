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
  });

  describe('formatAddress', () => {
    test('formats address with correct spacing', () => {
      const formatted = formatAddress(validAddresses.noSpaces);
      expect(formatted).toBe('NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX');
    });

    test('normalizes lowercase to uppercase', () => {
      const formatted = formatAddress(validAddresses.lowercase);
      expect(formatted).toBe('NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX');
    });

    test('normalizes mixed case to uppercase', () => {
      const formatted = formatAddress(validAddresses.mixedCase);
      expect(formatted).toBe('NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX');
    });

    test('preserves already formatted address', () => {
      const formatted = formatAddress(validAddresses.basic);
      expect(formatted).toBe('NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX');
    });

    test('handles address with irregular spacing', () => {
      const irregular = 'NQ42  XXXX   XXXX XXXX XXXX XXXX XXXX XXXX XXXX';
      const formatted = formatAddress(irregular);
      expect(formatted).toBe('NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX');
    });

    test('handles empty string', () => {
      const formatted = formatAddress('');
      expect(formatted).toBe('');
    });
  });

  describe('truncateAddress', () => {
    test('truncates long address correctly', () => {
      const address = 'NQ42 XXXX XXXX XXXX XXXX XXXX XXXX XXXX XXXX';
      const truncated = truncateAddress(address);
      expect(truncated).toBe('NQ42...XXXX');
    });

    test('does not truncate short address', () => {
      const shortAddr = 'NQ42 XXXX';
      const truncated = truncateAddress(shortAddr);
      expect(truncated).toBe('NQ42 XXXX');
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
