import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { getAddressLabelService, _resetAddressLabelService } from './address-labels';
import { ADDRESS_BOOK } from '../data/address-book';

// Get first address book entry for testing
const addressBookEntries = Object.entries(ADDRESS_BOOK);
const [testBookAddress, testBookLabel] = addressBookEntries[0];

const MOCK_VALIDATORS = [
  {
    address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    name: 'Test Validator',
    logo: 'data:image/svg+xml;base64,PHN2Zz4=',
    accentColor: '#FF0000',
    hasDefaultLogo: false,
  },
  {
    address: 'NQ08 0000 0000 0000 0000 0000 0000 0000 0001',
    name: 'Default Logo Validator',
    logo: 'data:image/svg+xml;base64,default',
    accentColor: '#00FF00',
    hasDefaultLogo: true,
  },
];

describe('AddressLabelService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetAddressLabelService();
  });

  test('getLabel returns address book label for known address', () => {
    const service = getAddressLabelService();
    const label = service.getLabel(testBookAddress);
    expect(label).toBe(testBookLabel);
  });

  test('getLabel returns null for unknown address', () => {
    const service = getAddressLabelService();
    const label = service.getLabel('NQ99 ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ ZZZZ');
    expect(label).toBeNull();
  });

  test('getIcon returns null when no validators loaded', () => {
    const service = getAddressLabelService();
    const icon = service.getIcon(testBookAddress);
    expect(icon).toBeNull();
  });

  test('initialize fetches validators and resolves labels', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_VALIDATORS), { status: 200 }))
    ) as typeof fetch;

    const service = getAddressLabelService();
    await service.initialize();

    expect(service.getLabel('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe('Test Validator');
    expect(service.getIcon('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(
      'data:image/svg+xml;base64,PHN2Zz4='
    );
  });

  test('getIcon returns null for validator with default logo', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_VALIDATORS), { status: 200 }))
    ) as typeof fetch;

    const service = getAddressLabelService();
    await service.initialize();

    expect(service.getLabel('NQ08 0000 0000 0000 0000 0000 0000 0000 0001')).toBe('Default Logo Validator');
    expect(service.getIcon('NQ08 0000 0000 0000 0000 0000 0000 0000 0001')).toBeNull();
  });

  test('validator label takes priority over address book', async () => {
    // Use a known address book address as a "validator"
    const mockValidators = [
      {
        address: testBookAddress,
        name: 'Validator Override',
        logo: 'data:image/svg+xml;base64,override',
        accentColor: '#0000FF',
        hasDefaultLogo: false,
      },
    ];

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(mockValidators), { status: 200 }))
    ) as typeof fetch;

    const service = getAddressLabelService();
    await service.initialize();

    // Validator name should take priority
    expect(service.getLabel(testBookAddress)).toBe('Validator Override');
    expect(service.getIcon(testBookAddress)).toBe('data:image/svg+xml;base64,override');
  });

  test('handles fetch failure gracefully', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('Network error'))) as typeof fetch;

    const service = getAddressLabelService();
    // Should not throw
    await service.initialize();

    // Address book should still work
    expect(service.getLabel(testBookAddress)).toBe(testBookLabel);
  });

  test('handles non-ok response gracefully', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 }))
    ) as typeof fetch;

    const service = getAddressLabelService();
    await service.initialize();

    // Address book should still work
    expect(service.getLabel(testBookAddress)).toBe(testBookLabel);
  });
});
