import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// We need to test the AddressCache class, but it's exported as a singleton.
// To test properly, we'll need to work with time mocking.

describe('AddressCache', () => {
  // Store original Date.now and mock it
  let originalDateNow: () => number;
  let mockedTime: number;

  beforeEach(() => {
    originalDateNow = Date.now;
    mockedTime = 1000000;
    Date.now = () => mockedTime;
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  // Helper to advance time
  const advanceTime = (ms: number) => {
    mockedTime += ms;
  };

  // Import fresh module for each test to reset singleton state
  const getCache = async () => {
    // Dynamic import to get fresh instance-like behavior
    const { addressCache } = await import('./address-cache');
    addressCache.clear();
    return addressCache;
  };

  describe('get/set', () => {
    test('returns null for missing key', async () => {
      const cache = await getCache();
      expect(cache.get('nonexistent')).toBeNull();
    });

    test('stores and retrieves value', async () => {
      const cache = await getCache();
      const data = { id: 'test', value: 42 };
      cache.set('key1', data);
      expect(cache.get('key1')).toEqual(data);
    });

    test('returns null for expired entry', async () => {
      const cache = await getCache();
      cache.set('key1', { value: 'test' });

      // Advance time past TTL (60 seconds)
      advanceTime(61000);

      expect(cache.get('key1')).toBeNull();
    });

    test('returns value within TTL', async () => {
      const cache = await getCache();
      cache.set('key1', { value: 'test' });

      // Advance time but stay within TTL
      advanceTime(30000);

      expect(cache.get('key1')).toEqual({ value: 'test' });
    });

    test('deletes expired entry on access', async () => {
      const cache = await getCache();
      cache.set('key1', { value: 'test' });
      const initialSize = cache.size;

      advanceTime(61000);
      cache.get('key1');

      expect(cache.size).toBe(initialSize - 1);
    });
  });

  describe('setMultiple', () => {
    test('sets multiple entries at once', async () => {
      const cache = await getCache();
      cache.setMultiple([
        { id: 'a', data: { val: 1 } },
        { id: 'b', data: { val: 2 } },
        { id: 'c', data: { val: 3 } },
      ]);

      expect(cache.get('a')).toEqual({ val: 1 });
      expect(cache.get('b')).toEqual({ val: 2 });
      expect(cache.get('c')).toEqual({ val: 3 });
    });

    test('all entries have same expiration time', async () => {
      const cache = await getCache();
      cache.setMultiple([
        { id: 'a', data: { val: 1 } },
        { id: 'b', data: { val: 2 } },
      ]);

      // Just under TTL - all should exist
      advanceTime(59000);
      expect(cache.get('a')).not.toBeNull();
      expect(cache.get('b')).not.toBeNull();

      // Just over TTL - all should expire together
      advanceTime(2000);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
    });
  });

  describe('getMultiple', () => {
    test('returns cached hits and missing keys separately', async () => {
      const cache = await getCache();
      cache.set('a', { val: 1 });
      cache.set('b', { val: 2 });

      const result = cache.getMultiple(['a', 'b', 'c', 'd']);

      expect(result.cached.get('a')).toEqual({ val: 1 });
      expect(result.cached.get('b')).toEqual({ val: 2 });
      expect(result.missing).toEqual(['c', 'd']);
    });

    test('treats expired entries as missing', async () => {
      const cache = await getCache();
      cache.set('a', { val: 1 });
      advanceTime(61000);
      cache.set('b', { val: 2 });

      const result = cache.getMultiple(['a', 'b']);

      expect(result.cached.has('a')).toBe(false);
      expect(result.cached.get('b')).toEqual({ val: 2 });
      expect(result.missing).toEqual(['a']);
    });

    test('returns empty cached map when all missing', async () => {
      const cache = await getCache();
      const result = cache.getMultiple(['x', 'y', 'z']);

      expect(result.cached.size).toBe(0);
      expect(result.missing).toEqual(['x', 'y', 'z']);
    });
  });

  describe('invalidate', () => {
    test('removes specific entry', async () => {
      const cache = await getCache();
      cache.set('a', { val: 1 });
      cache.set('b', { val: 2 });

      cache.invalidate('a');

      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toEqual({ val: 2 });
    });

    test('does nothing for non-existent key', async () => {
      const cache = await getCache();
      cache.set('a', { val: 1 });
      const sizeBefore = cache.size;

      cache.invalidate('nonexistent');

      expect(cache.size).toBe(sizeBefore);
    });
  });

  describe('clear', () => {
    test('removes all entries', async () => {
      const cache = await getCache();
      cache.set('a', { val: 1 });
      cache.set('b', { val: 2 });
      cache.set('c', { val: 3 });

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
      expect(cache.get('c')).toBeNull();
    });
  });

  describe('size', () => {
    test('returns correct count', async () => {
      const cache = await getCache();
      expect(cache.size).toBe(0);

      cache.set('a', { val: 1 });
      expect(cache.size).toBe(1);

      cache.set('b', { val: 2 });
      expect(cache.size).toBe(2);

      cache.invalidate('a');
      expect(cache.size).toBe(1);
    });
  });
});
