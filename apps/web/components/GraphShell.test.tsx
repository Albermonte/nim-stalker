import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { GraphShell } from './GraphShell';

describe('GraphShell', () => {
  test('renders title as a link to the home route', () => {
    const html = renderToStaticMarkup(<GraphShell />);

    expect(html).toContain('NIM STALKER');
    expect(html).toContain('href="/"');
  });
});
