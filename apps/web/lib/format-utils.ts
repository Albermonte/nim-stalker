/**
 * Format address to standard display format (NQ42 XXXX XXXX ...)
 * Adds spaces every 4 characters for readability
 */
export function formatNimiqAddress(address: string): string {
  const cleaned = address.replace(/\s/g, '').toUpperCase();
  return cleaned.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Format lunas to NIM with locale formatting
 */
export function formatNimiq(lunas: string | bigint): string {
  const value = typeof lunas === 'string' ? BigInt(lunas) : lunas;
  const nim = Number(value) / 1e5;
  return nim.toLocaleString(undefined, { maximumFractionDigits: 5 }) + ' NIM';
}

/**
 * Get nimiq.watch explorer URL for an address
 */
export function getNimiqWatchUrl(address: string): string {
  const formatted = formatNimiqAddress(address);
  return `https://nimiq.watch/#${formatted.replace(/ /g, '+')}`;
}

/**
 * Format ISO date string to localized short date
 */
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Truncate address for display (NQ42...XXXX)
 */
export function truncateAddress(address: string): string {
  if (address.length <= 11) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
