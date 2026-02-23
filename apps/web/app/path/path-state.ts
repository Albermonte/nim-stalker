import { formatNimiqAddress } from '@/lib/format-utils';
import { isAddressSlug, safeDecodeURIComponent, urlSlugToAddress } from '@/lib/url-utils';

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

export interface PathViewSnapshot {
  active: boolean;
  from: string | null;
  to: string | null;
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
