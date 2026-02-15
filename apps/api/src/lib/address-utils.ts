/**
 * Shared address validation and formatting utilities for Nimiq addresses
 */

/**
 * Validate Nimiq address format (NQ followed by 2 digits and 32 alphanumeric chars)
 * Accepts addresses with or without spaces
 */
export function isValidNimiqAddress(address: string): boolean {
  const cleaned = address.replace(/\s/g, '');
  return /^NQ\d{2}[A-Z0-9]{32}$/i.test(cleaned);
}

/**
 * Format address to standard format (NQ42 XXXX XXXX ...)
 * Normalizes to uppercase with spaces every 4 characters
 */
export function formatAddress(address: string): string {
  const cleaned = address.replace(/\s/g, '').toUpperCase();
  return cleaned.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Truncate address for display (NQ42...XXXX)
 */
export function truncateAddress(address: string): string {
  if (address.length <= 11) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
