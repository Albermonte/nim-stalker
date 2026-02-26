import { describe, expect, test } from 'bun:test';
import {
  parsePathRequest,
  parsePathRequests,
  isPathRequestAlreadyActive,
  isPathRequestSetAlreadyActive,
  type ParsedPathRequest,
} from './path-state';

const FROM = 'NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A';
const TO = 'NQ60GH2TVEA2CUR5SXADQU9B7ELDYMG55T7U';

function parseOrThrow(searchParams: URLSearchParams): ParsedPathRequest {
  const parsed = parsePathRequest(searchParams);
  if (!parsed.ok) {
    throw new Error(`unexpected parse error: ${parsed.reason}`);
  }
  return parsed.value;
}

function parseRequestsOrThrow(searchParams: URLSearchParams): ParsedPathRequest[] {
  const parsed = parsePathRequests(searchParams);
  if (!parsed.ok) {
    throw new Error(`unexpected parse error: ${parsed.reason}`);
  }
  return parsed.value;
}

describe('path-state', () => {
  test('parses canonical /path query state', () => {
    const parsed = parseOrThrow(
      new URLSearchParams({
        from: FROM,
        to: TO,
        maxHops: '4',
        directed: 'true',
      }),
    );

    expect(parsed.fromAddress).toBe('NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A');
    expect(parsed.toAddress).toBe('NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U');
    expect(parsed.maxHops).toBe(4);
    expect(parsed.directed).toBe(true);
    expect(parsed.requestKey).toBe(
      'NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A|NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U|4|true',
    );
  });

  test('parses canonical repeated p multi-path state', () => {
    const params = new URLSearchParams();
    params.append('p', `${FROM},${TO},3,false`);
    params.append('p', `${TO},${FROM},4,true`);
    const parsed = parseRequestsOrThrow(params);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.maxHops).toBe(3);
    expect(parsed[0]?.directed).toBe(false);
    expect(parsed[1]?.maxHops).toBe(4);
    expect(parsed[1]?.directed).toBe(true);
  });

  test('parses repeated p entries while preserving order', () => {
    const params = new URLSearchParams();
    params.append('p', `${FROM},${TO},3,false`);
    params.append('p', `${TO},${FROM},2,true`);

    const parsed = parseRequestsOrThrow(params);

    expect(parsed.map((entry) => entry.toAddress)).toEqual([
      'NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U',
      'NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A',
    ]);
  });

  test('falls back to legacy single-path query format when p is absent', () => {
    const parsed = parseRequestsOrThrow(
      new URLSearchParams({
        from: FROM,
        to: TO,
        maxHops: '3',
        directed: 'false',
      }),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.requestKey).toBe(
      'NQ20 8P9L 3YMD GQYT 1TAA 8D0G MC12 5HBQ 1Q8A|NQ60 GH2T VEA2 CUR5 SXAD QU9B 7ELD YMG5 5T7U|3|false',
    );
  });

  test('returns missing_params when from/to are absent', () => {
    const parsed = parsePathRequests(new URLSearchParams({}));
    expect(parsed).toEqual({ ok: false, reason: 'missing_params' });
  });

  test('returns invalid_address when address params are malformed', () => {
    const parsed = parsePathRequests(
      new URLSearchParams({
        from: 'NOT_A_VALID_ADDRESS',
        to: TO,
      }),
    );
    expect(parsed).toEqual({ ok: false, reason: 'invalid_address' });
  });

  test('returns invalid_address for malformed p entries', () => {
    const params = new URLSearchParams();
    params.append('p', `${FROM},${TO},3,false,extra`);

    const parsed = parsePathRequests(params);
    expect(parsed).toEqual({ ok: false, reason: 'invalid_address' });
  });

  test('enforces max 10 parsed p entries', () => {
    const params = new URLSearchParams();
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 === 0) {
        params.append('p', `${FROM},${TO},3,false`);
      } else {
        params.append('p', `${TO},${FROM},3,true`);
      }
    }

    const parsed = parseRequestsOrThrow(params);
    expect(parsed).toHaveLength(10);
  });

  test('sanitizes maxHops and directed defaults', () => {
    const parsed = parseOrThrow(
      new URLSearchParams({
        from: FROM,
        to: TO,
        maxHops: '999',
        directed: 'not-a-bool',
      }),
    );

    expect(parsed.maxHops).toBe(10);
    expect(parsed.directed).toBe(false);
  });

  test('matches active path request against current path view state', () => {
    const parsed = parseOrThrow(
      new URLSearchParams({
        from: FROM,
        to: TO,
        maxHops: '3',
        directed: 'false',
      }),
    );

    expect(
      isPathRequestAlreadyActive(
        {
          active: true,
          from: parsed.fromAddress,
          to: parsed.toAddress,
          stats: {
            maxHops: 3,
            directed: false,
          },
        },
        parsed,
      ),
    ).toBe(true);

    expect(
      isPathRequestAlreadyActive(
        {
          active: true,
          from: parsed.fromAddress,
          to: parsed.toAddress,
          stats: {
            maxHops: 4,
            directed: false,
          },
        },
        parsed,
      ),
    ).toBe(false);
  });

  test('matches active multi-path request set against current path view state', () => {
    const params = new URLSearchParams();
    params.append('p', `${FROM},${TO},3,false`);
    params.append('p', `${TO},${FROM},4,true`);
    const parsed = parseRequestsOrThrow(params);

    expect(
      isPathRequestSetAlreadyActive(
        {
          active: true,
          from: parsed[0]!.fromAddress,
          to: parsed[0]!.toAddress,
          paths: parsed.map((entry) => ({
            from: entry.fromAddress,
            to: entry.toAddress,
            maxHops: entry.maxHops,
            directed: entry.directed,
            requestKey: entry.requestKey,
          })),
          stats: {
            maxHops: 3,
            directed: false,
          },
        },
        parsed,
      ),
    ).toBe(true);
  });

  test('treats reordered active multi-path requests as different', () => {
    const params = new URLSearchParams();
    params.append('p', `${FROM},${TO},3,false`);
    params.append('p', `${TO},${FROM},4,true`);
    const parsed = parseRequestsOrThrow(params);
    const reversed = [parsed[1]!, parsed[0]!];

    expect(
      isPathRequestSetAlreadyActive(
        {
          active: true,
          from: parsed[0]!.fromAddress,
          to: parsed[0]!.toAddress,
          paths: parsed.map((entry) => ({
            from: entry.fromAddress,
            to: entry.toAddress,
            maxHops: entry.maxHops,
            directed: entry.directed,
            requestKey: entry.requestKey,
          })),
          stats: {
            maxHops: 3,
            directed: false,
          },
        },
        reversed,
      ),
    ).toBe(false);
  });
});
