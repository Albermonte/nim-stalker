/**
 * Test setup for Web frontend tests
 * This file is preloaded before all tests
 */

import { beforeEach, afterEach } from 'bun:test';
import { Window } from 'happy-dom';
import '@testing-library/jest-dom';

if (!globalThis.window || !globalThis.document) {
  const window = new Window();

  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    DocumentFragment: window.DocumentFragment,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    DOMRect: window.DOMRect,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
}

// Set test environment
process.env.NODE_ENV = 'test';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

// Mock next/navigation
const mockRouter = {
  push: () => {},
  replace: () => {},
  refresh: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
};

const mockPathname = '/';
const mockSearchParams = new URLSearchParams();

// Export mocks for tests that need to customize them
export const navigationMocks = {
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
};

// DOM cleanup using safe method (only if DOM is available)
afterEach(() => {
  if (typeof document !== 'undefined' && document.body) {
    // Clean up DOM by removing all child nodes
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  }
});

// Suppress console errors in tests unless needed
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = (...args: unknown[]) => {
    // Filter out expected React errors
    const message = args[0]?.toString() || '';
    if (message.includes('Warning:') || message.includes('React')) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
});

afterEach(() => {
  console.error = originalConsoleError;
});
