import { formatNimiqAddress } from '@/lib/format-utils';
import { isAddressSlug, MAX_PATH_URL_ENTRIES, safeDecodeURIComponent, urlSlugToAddress } from '@/lib/url-utils';

const DEFAULT_MAX_HOPS = 3;
const MIN_MAX_HOPS = 1;
const MAX_MAX_HOPS = 10;

type PathQueryParseError = 'missing_params' | 'invalid_address';

export interface ParsedPathRequest {
  fromAddress: string;
  toAddress: string;
  maxHops: number;
  directed: boolean;
  requestKey: string;
}

export type ParsedPathRequestResult =
  | { ok: true; value: ParsedPathRequest }
  | { ok: false; reason: PathQueryParseError };

export type ParsedPathRequestsResult =
  | { ok: true; value: ParsedPathRequest[] }
  | { ok: false; reason: PathQueryParseError };

export interface PathViewSnapshot {
  active: boolean;
  from: string | null;
  to: string | null;
  paths?: Array<{
    from: string;
    to: string;
    maxHops: number;
    directed: boolean;
    requestKey: string;
  }>;
  stats: {
    maxHops: number;
    directed: boolean;
  } | null;
}

function parseAddressParam(raw: string | null): string | null {
  if (!raw) return null;
  const decoded = safeDecodeURIComponent(raw);
  if (!decoded || !isAddressSlug(decoded)) return null;
  return formatNimiqAddress(urlSlugToAddress(decoded));
}

function parseMaxHops(raw: string | null): number {
  if (!raw) return DEFAULT_MAX_HOPS;
  const value = Number(raw);
  if (!Number.isInteger(value)) return DEFAULT_MAX_HOPS;
  return Math.min(MAX_MAX_HOPS, Math.max(MIN_MAX_HOPS, value));
}

function parseDirected(raw: string | null): boolean {
  return raw === 'true';
}

export function parsePathRequest(searchParams: URLSearchParams): ParsedPathRequestResult {
  const rawFrom = searchParams.get('from');
  const rawTo = searchParams.get('to');
  if (!rawFrom || !rawTo) {
    return { ok: false, reason: 'missing_params' };
  }

  const fromAddress = parseAddressParam(rawFrom);
  const toAddress = parseAddressParam(rawTo);
  if (!fromAddress || !toAddress) {
    return { ok: false, reason: 'invalid_address' };
  }

  const maxHops = parseMaxHops(searchParams.get('maxHops'));
  const directed = parseDirected(searchParams.get('directed'));
  return {
    ok: true,
    value: {
      fromAddress,
      toAddress,
      maxHops,
      directed,
      requestKey: `${fromAddress}|${toAddress}|${maxHops}|${directed}`,
    },
  };
}

function parsePathEntry(rawEntry: string): ParsedPathRequest | null {
  const parts = rawEntry.split(',');
  if (parts.length < 2 || parts.length > 4) return null;

  const [rawFrom, rawTo, rawMaxHops, rawDirected] = parts;
  const fromAddress = parseAddressParam(rawFrom);
  const toAddress = parseAddressParam(rawTo);
  if (!fromAddress || !toAddress || fromAddress === toAddress) return null;

  const maxHops = parseMaxHops(rawMaxHops ?? null);
  const directed = parseDirected(rawDirected ?? null);

  return {
    fromAddress,
    toAddress,
    maxHops,
    directed,
    requestKey: `${fromAddress}|${toAddress}|${maxHops}|${directed}`,
  };
}

/**
 * Parse `/path` query state.
 * Supports both:
 * - canonical multi-path format: ?p=<from>,<to>,<maxHops>,<directed>&p=...
 * - legacy single-path format: ?from=<from>&to=<to>&maxHops=<n>&directed=<bool>
 */
export function parsePathRequests(searchParams: URLSearchParams): ParsedPathRequestsResult {
  const rawPathEntries = searchParams.getAll('p').filter((value) => value.trim().length > 0);

  if (rawPathEntries.length > 0) {
    const boundedEntries = rawPathEntries.slice(0, MAX_PATH_URL_ENTRIES);
    const parsedEntries: ParsedPathRequest[] = [];

    for (const rawEntry of boundedEntries) {
      const parsedEntry = parsePathEntry(rawEntry);
      if (!parsedEntry) {
        return { ok: false, reason: 'invalid_address' };
      }
      parsedEntries.push(parsedEntry);
    }

    if (parsedEntries.length === 0) {
      return { ok: false, reason: 'missing_params' };
    }

    return { ok: true, value: parsedEntries };
  }

  const legacyParsed = parsePathRequest(searchParams);
  if (!legacyParsed.ok) {
    return legacyParsed;
  }

  return { ok: true, value: [legacyParsed.value] };
}

export function isPathRequestAlreadyActive(
  pathView: PathViewSnapshot,
  request: ParsedPathRequest,
): boolean {
  return Boolean(
    pathView.active &&
      pathView.from === request.fromAddress &&
      pathView.to === request.toAddress &&
      pathView.stats &&
      pathView.stats.maxHops === request.maxHops &&
      pathView.stats.directed === request.directed,
  );
}

export function isPathRequestSetAlreadyActive(
  pathView: PathViewSnapshot,
  requests: ParsedPathRequest[],
): boolean {
  if (!pathView.active || requests.length === 0) {
    return false;
  }

  const activePaths = pathView.paths ?? [];
  if (activePaths.length > 0) {
    if (activePaths.length !== requests.length) {
      return false;
    }

    for (let i = 0; i < activePaths.length; i += 1) {
      const active = activePaths[i];
      const incoming = requests[i];
      if (
        active.requestKey !== incoming.requestKey ||
        active.from !== incoming.fromAddress ||
        active.to !== incoming.toAddress ||
        active.maxHops !== incoming.maxHops ||
        active.directed !== incoming.directed
      ) {
        return false;
      }
    }

    return true;
  }

  // Backward compatibility for legacy path view state (single entry without `paths` list)
  if (requests.length !== 1) {
    return false;
  }

  return isPathRequestAlreadyActive(pathView, requests[0]);
}
