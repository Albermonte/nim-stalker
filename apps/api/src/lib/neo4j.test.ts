import { describe, test, expect } from 'bun:test';
import neo4j from 'neo4j-driver';
import { toBigIntString } from './neo4j';

describe('toBigIntString', () => {
  test('null returns "0"', () => {
    expect(toBigIntString(null)).toBe('0');
  });

  test('undefined returns "0"', () => {
    expect(toBigIntString(undefined)).toBe('0');
  });

  test('number returns string representation', () => {
    expect(toBigIntString(42)).toBe('42');
    expect(toBigIntString(0)).toBe('0');
    expect(toBigIntString(123456789)).toBe('123456789');
  });

  test('bigint returns string representation', () => {
    expect(toBigIntString(BigInt('999999999999999999'))).toBe('999999999999999999');
    expect(toBigIntString(0n)).toBe('0');
  });

  test('string is returned as-is', () => {
    expect(toBigIntString('12345')).toBe('12345');
    expect(toBigIntString('0')).toBe('0');
    expect(toBigIntString('999999999999999999')).toBe('999999999999999999');
  });

  test('Neo4j Integer converts to string', () => {
    const int = neo4j.int(12345);
    expect(toBigIntString(int)).toBe('12345');
  });
});
