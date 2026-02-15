import { describe, test, expect } from 'bun:test';
import { identiconManager } from './identicon-manager';

describe('identicon manager cleanup', () => {
  test('dispose clears pending conversions', () => {
    const pending = (identiconManager as any).pending as Set<string>;
    pending.add('NQ42TESTTESTTESTTESTTESTTESTTESTTESTTESTTEST');

    identiconManager.dispose();

    expect(pending.size).toBe(0);
  });
});
