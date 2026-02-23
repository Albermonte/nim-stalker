import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  ensureLayoutRegistered,
  resetLayoutLoaderStateForTests,
  setLayoutLoaderCytoscapeHostForTests,
} from './layout-loader';

afterEach(() => {
  resetLayoutLoaderStateForTests();
  setLayoutLoaderCytoscapeHostForTests(null);
  mock.restore();
});

describe('layout-loader', () => {
  test('retries failed registration and supports nested default export shapes', async () => {
    let shouldFailRegistration = true;
    const use = mock(() => {
      if (shouldFailRegistration) {
        shouldFailRegistration = false;
        throw new Error('transient registration failure');
      }
    });
    const dagrePlugin = () => {};

    mock.module('cytoscape-cola', () => {
      return {
        default: () => {},
      };
    });
    mock.module('cytoscape-dagre', () => ({
      default: {
        default: dagrePlugin,
      },
    }));

    setLayoutLoaderCytoscapeHostForTests({ use });

    await expect(ensureLayoutRegistered('cola')).rejects.toThrow('transient registration failure');
    await expect(ensureLayoutRegistered('cola')).resolves.toBeUndefined();
    await expect(ensureLayoutRegistered('dagre-lr')).resolves.toBeUndefined();

    expect(use).toHaveBeenCalledTimes(3);
    expect(use.mock.calls[2]?.[0]).toBe(dagrePlugin);
  });
});
