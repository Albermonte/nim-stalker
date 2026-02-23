import { ValidationUtils } from '@nimiq/utils';
import type { Direction } from '@nim-stalker/shared';

/**
 * Check if a URL slug is a valid Nimiq address (spaceless format)
 */
export function isAddressSlug(slug: string): boolean {
  const cleaned = slug.replace(/\s/g, '').toUpperCase();
  return ValidationUtils.isValidAddress(cleaned);
}

/**
 * Check if a URL slug is a transaction hash (64 hex characters)
 */
export function isTxHash(slug: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(slug);
}

/**
 * Safe decode helper for route and query params.
 * Returns null for malformed percent-encoded values.
 */
export function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Convert a Nimiq address to a URL-friendly slug (strip spaces)
 */
export function addressToUrlSlug(address: string): string {
  return address.replace(/\s/g, '').toUpperCase();
}

/**
 * Build canonical address route
 */
export function buildAddressRoute(address: string): string {
  return `/address/${addressToUrlSlug(address)}`;
}

/**
 * Build canonical address timeline route
 */
export function buildAddressTxRoute(
  address: string,
  direction: Direction = 'both',
  limit: number = 200
): string {
  const params = new URLSearchParams({
    direction,
    limit: String(limit),
  });
  return `${buildAddressRoute(address)}/tx?${params.toString()}`;
}

/**
 * Build canonical single transaction route
 */
export function buildTxRoute(hash: string): string {
  return `/tx/${encodeURIComponent(hash)}`;
}

/**
 * Convert a URL slug back to a clean address string (uppercase, no spaces)
 * Ready for formatNimiqAddress() to add spaces
 */
export function urlSlugToAddress(slug: string): string {
  return slug.replace(/\s/g, '').toUpperCase();
}

/**
 * Build a shareable path URL
 */
export function buildPathUrl(from: string, to: string, maxHops: number, directed: boolean): string {
  const params = new URLSearchParams({
    from: addressToUrlSlug(from),
    to: addressToUrlSlug(to),
    maxHops: String(maxHops),
    directed: String(directed),
  });
  return `/path?${params.toString()}`;
}
