import { describe, expect, test } from 'bun:test';
import { addressToUrlSlug, buildAddressHashUrl, getAddressSlugFromHash } from './url-utils';

describe('url-utils', () => {
  describe('buildAddressHashUrl', () => {
    test('builds hash URL for formatted address', () => {
      const address = 'NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19';
      expect(buildAddressHashUrl(address)).toBe('/#NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
    });

    test('normalizes lowercase/unformatted address', () => {
      const address = 'nq15mljn23yb8fbm61tn7lyg2212lvbg4v19';
      expect(buildAddressHashUrl(address)).toBe('/#NQ15MLJN23YB8FBM61TN7LYG2212LVBG4V19');
    });
  });

  describe('getAddressSlugFromHash', () => {
    test('extracts slug from hash value', () => {
      const slug = getAddressSlugFromHash('#nq15mljn23yb8fbm61tn7lyg2212lvbg4v19');
      expect(slug).toBe(addressToUrlSlug('NQ15 MLJN 23YB 8FBM 61TN 7LYG 2212 LVBG 4V19'));
    });

    test('returns null when hash is missing', () => {
      expect(getAddressSlugFromHash('')).toBeNull();
    });

    test('returns null for malformed percent-encoded hash', () => {
      expect(getAddressSlugFromHash('#%E0%A4%A')).toBeNull();
    });
  });
});
