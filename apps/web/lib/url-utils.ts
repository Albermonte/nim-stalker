import { ValidationUtils } from '@nimiq/utils';
import type { Direction } from '@nim-stalker/shared';

export const MAX_PATH_URL_ENTRIES = 10;

export interface PathUrlEntry {
  from: string;
  to: string;
  maxHops: number;
  directed: boolean;
}

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
  return buildMultiPathUrl([{ from, to, maxHops, directed }]);
}

/**
 * Build a shareable multi-path URL.
 * Uses repeated `p` params in insertion order:
 * /path?p=<from>,<to>,<maxHops>,<directed>&p=...
 */
export function buildMultiPathUrl(entries: PathUrlEntry[]): string {
  const params = new URLSearchParams();
  const boundedEntries = entries.slice(0, MAX_PATH_URL_ENTRIES);

  for (const entry of boundedEntries) {
    const from = addressToUrlSlug(entry.from);
    const to = addressToUrlSlug(entry.to);
    params.append('p', `${from},${to},${entry.maxHops},${entry.directed}`);
  }

  const query = params.toString();
  return query ? `/path?${query}` : '/path';
}
