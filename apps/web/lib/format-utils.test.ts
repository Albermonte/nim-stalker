import { describe, test, expect } from 'bun:test';
import {
  formatNimiqAddress,
  formatNimiq,
  getNimiqWatchUrl,
  formatDate,
  truncateAddress,
} from './format-utils';

describe('format-utils', () => {
  describe('formatNimiqAddress', () => {
    test('formats address without spaces', () => {
      const result = formatNimiqAddress('NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
      expect(result).toBe('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19');
    });

    test('normalizes lowercase to uppercase', () => {
      const result = formatNimiqAddress('nq15mljn23yb8fbm61tn7lyg2212lvbg4v19');
      expect(result).toBe('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19');
    });

    test('preserves already formatted address', () => {
      const result = formatNimiqAddress('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19');
      expect(result).toBe('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19');
    });

    test('removes extra spaces', () => {
      const result = formatNimiqAddress('NQ15  MLJN   23YB 8FBM');
      expect(result).toBe('NQ15 MLJN 23YB 8FBM');
    });

    test('handles empty string', () => {
      const result = formatNimiqAddress('');
      expect(result).toBe('');
    });
  });

  describe('formatNimiq', () => {
    test('converts lunas to NIM (string input)', () => {
      const result = formatNimiq('100000'); // 1 NIM = 100,000 lunas
      expect(result).toContain('1');
      expect(result).toContain('NIM');
    });

    test('converts lunas to NIM (bigint input)', () => {
      const result = formatNimiq(BigInt(100000));
      expect(result).toContain('1');
      expect(result).toContain('NIM');
    });

    test('handles zero', () => {
      const result = formatNimiq('0');
      expect(result).toBe('0 NIM');
    });

    test('handles large amounts', () => {
      const result = formatNimiq('1000000000'); // 10,000 NIM
      expect(result).toContain('10');
      expect(result).toContain('NIM');
    });

    test('handles fractional amounts', () => {
      const result = formatNimiq('50000'); // 0.5 NIM
      expect(result).toContain('0.5');
      expect(result).toContain('NIM');
    });

    test('handles very small amounts', () => {
      const result = formatNimiq('1'); // 0.00001 NIM
      expect(result).toContain('0.00001');
      expect(result).toContain('NIM');
    });
  });

  describe('getNimiqWatchUrl', () => {
    test('generates correct URL for formatted address', () => {
      const result = getNimiqWatchUrl('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19');
      expect(result).toBe('https://nimiq.watch/#NQ15+MLJN+23YB+8FBM+61TN+7LYG+2212+LVBG+4V19');
    });

    test('generates correct URL for unformatted address', () => {
      const result = getNimiqWatchUrl('NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
      expect(result).toBe('https://nimiq.watch/#NQ15+MLJN+23YB+8FBM+61TN+7LYG+2212+LVBG+4V19');
    });

    test('normalizes lowercase address', () => {
      const result = getNimiqWatchUrl('nq15mljn23yb8fbm61tn7lyg2212lvbg4v19');
      expect(result).toBe('https://nimiq.watch/#NQ15+MLJN+23YB+8FBM+61TN+7LYG+2212+LVBG+4V19');
    });

    test('replaces spaces with plus signs', () => {
      const result = getNimiqWatchUrl('NQ42 TEST ADDR');
      expect(result).not.toContain(' ');
      expect(result).toContain('+');
    });
  });

  describe('formatDate', () => {
    test('formats ISO date string', () => {
      const result = formatDate('2024-01-15T12:00:00.000Z');
      // Result depends on locale, but should contain year and month
      expect(result).toContain('2024');
      expect(result.length).toBeGreaterThan(5);
    });

    test('formats different dates', () => {
      const result1 = formatDate('2023-06-01T00:00:00.000Z');
      const result2 = formatDate('2024-12-25T00:00:00.000Z');

      expect(result1).not.toBe(result2);
    });

    test('handles date at midnight', () => {
      const result = formatDate('2024-01-01T00:00:00.000Z');
      expect(result).toContain('2024');
    });

    test('handles date at end of day', () => {
      const result = formatDate('2024-12-31T23:59:59.999Z');
      expect(result).toContain('2024');
    });
  });

  describe('truncateAddress', () => {
    test('truncates long address correctly', () => {
      const address = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      const result = truncateAddress(address);
      expect(result).toBe('NQ15...4V19');
    });

    test('does not truncate short address', () => {
      const result = truncateAddress('NQ15 MLJN');
      expect(result).toBe('NQ15 MLJN');
    });

    test('handles exactly 11 character address', () => {
      const result = truncateAddress('12345678901');
      expect(result).toBe('12345678901');
    });

    test('handles 12 character address (boundary)', () => {
      const result = truncateAddress('123456789012');
      expect(result).toBe('1234...9012');
    });

    test('handles empty string', () => {
      const result = truncateAddress('');
      expect(result).toBe('');
    });
  });
});
