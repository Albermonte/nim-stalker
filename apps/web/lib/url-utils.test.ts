import { describe, expect, test } from 'bun:test';
import {
  addressToUrlSlug,
  buildAddressRoute,
  buildAddressTxRoute,
  buildPathUrl,
  buildTxRoute,
  safeDecodeURIComponent,
} from './url-utils';

describe('url-utils', () => {
  describe('buildAddressRoute', () => {
    test('builds address route for formatted address', () => {
      const address = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      expect(buildAddressRoute(address)).toBe('/address/NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
    });

    test('normalizes lowercase/unformatted address', () => {
      const address = 'nq15mljn23yb8fbm61tn7lyg2212lvbg4v19';
      expect(buildAddressRoute(address)).toBe('/address/NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
    });
  });

  describe('buildAddressTxRoute', () => {
    test('builds address tx route with defaults', () => {
      const address = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      expect(buildAddressTxRoute(address)).toBe('/address/NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19/tx?direction=both&limit=200');
    });

    test('builds address tx route with explicit options', () => {
      const address = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      expect(buildAddressTxRoute(address, 'incoming', 50)).toBe('/address/NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19/tx?direction=incoming&limit=50');
    });
  });

  describe('buildTxRoute', () => {
    test('builds tx route for hash', () => {
      const hash = 'abcd'.repeat(16);
      expect(buildTxRoute(hash)).toBe(`/${'tx'}/${hash}`);
    });
  });

  describe('buildPathUrl', () => {
    test('builds canonical /path query route', () => {
      const from = addressToUrlSlug('NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA');
      const to = addressToUrlSlug('NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB');
      expect(buildPathUrl(from, to, 3, false)).toBe(`/path?from=${from}&to=${to}&maxHops=3&directed=false`);
    });
  });

  describe('safeDecodeURIComponent', () => {
    test('decodes valid input', () => {
      expect(safeDecodeURIComponent('NQ20%208P9L')).toBe('NQ20 8P9L');
    });

    test('returns null for malformed encoding', () => {
      expect(safeDecodeURIComponent('%E0%A4%A')).toBeNull();
    });
  });
});
