import { ValidationUtils } from '@nimiq/utils';

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
export function isTxHashSlug(slug: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(slug);
}

/**
 * Convert a Nimiq address to a URL-friendly slug (strip spaces)
 */
export function addressToUrlSlug(address: string): string {
  return address.replace(/\s/g, '').toUpperCase();
}

/**
 * Build a hash-based address URL (keeps app on home route)
 */
export function buildAddressHashUrl(address: string): string {
  return `/#${addressToUrlSlug(address)}`;
}

/**
 * Extract and normalize address slug from location hash
 */
export function getAddressSlugFromHash(hash: string): string | null {
  if (!hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return addressToUrlSlug(decodeURIComponent(raw));
  } catch {
    return null;
  }
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
