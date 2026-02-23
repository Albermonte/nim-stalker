import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { mock } from 'bun:test';

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: mock(() => {}),
    replace: mock(() => {}),
    refresh: mock(() => {}),
    back: mock(() => {}),
    forward: mock(() => {}),
    prefetch: mock(() => Promise.resolve()),
  }),
  usePathname: () => '/',
}));

import { GraphShell } from './GraphShell';

describe('GraphShell', () => {
  test('renders title as a link to the home route', () => {
    const html = renderToStaticMarkup(<GraphShell />);

    expect(html).toContain('NIM STALKER');
    expect(html).toContain('href="/"');
  });
});
