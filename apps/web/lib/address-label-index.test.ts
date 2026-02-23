import { describe, expect, test } from 'bun:test';
import { ADDRESS_BOOK } from '@nim-stalker/shared/address-book';
import { LABEL_OPTIONS, LABEL_TO_ADDRESS, resolveAddressInput } from './address-label-index';

describe('address-label-index', () => {
  test('contains Nimiq Sunset Cyberspace in label options', () => {
    const label = LABEL_OPTIONS.find((entry) => entry.label === 'Nimiq Sunset Cyberspace');
    expect(label).toBeDefined();
    expect(label?.address).toBe('NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A');
  });

  test('resolves exact label case-insensitively', () => {
    const result = resolveAddressInput('  nimiq sunset cyberspace ');
    expect(result.error).toBeNull();
    expect(result.address).toBe('NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
  });

  test('duplicate labels use first match only', () => {
    const firstKuCoinOld = Object.entries(ADDRESS_BOOK).find(([, label]) => label === 'KuCoin (old)')?.[0];
    expect(firstKuCoinOld).toBeDefined();

    expect(LABEL_TO_ADDRESS.get('kucoin (old)')).toBe(firstKuCoinOld);
    const result = resolveAddressInput('KuCoin (old)');
    expect(result.error).toBeNull();
    expect(result.address).toBe(firstKuCoinOld?.replace(/\s/g, '').toUpperCase());
  });

  test('passes through valid nimiq address', () => {
    const result = resolveAddressInput('NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A');
    expect(result.error).toBeNull();
    expect(result.address).toBe('NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
  });

  test('returns validation errors for empty and invalid input', () => {
    expect(resolveAddressInput('   ')).toEqual({
      address: null,
      error: 'Please enter an address',
    });
    expect(resolveAddressInput('not-a-valid-address-or-label')).toEqual({
      address: null,
      error: 'Invalid Nimiq address format',
    });
  });
});
