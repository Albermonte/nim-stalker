import { describe, expect, test } from 'bun:test';
import { parsePathRequest, isPathRequestAlreadyActive, type ParsedPathRequest } from './path-state';

const FROM = 'NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A';
const TO = 'NQ60GH2TVEA2CUR5SXADQU9B7ELDYMG55T7U';

function parseOrThrow(searchParams: URLSearchParams): ParsedPathRequest {
  const parsed = parsePathRequest(searchParams);
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

  test('returns missing_params when from/to are absent', () => {
    const parsed = parsePathRequest(new URLSearchParams({}));
    expect(parsed).toEqual({ ok: false, reason: 'missing_params' });
  });

  test('returns invalid_address when address params are malformed', () => {
    const parsed = parsePathRequest(
      new URLSearchParams({
        from: 'NOT_A_VALID_ADDRESS',
        to: TO,
      }),
    );
    expect(parsed).toEqual({ ok: false, reason: 'invalid_address' });
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
});
