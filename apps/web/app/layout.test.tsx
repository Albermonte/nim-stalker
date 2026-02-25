import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import RootLayout from './layout';

describe('RootLayout', () => {
  it('renders children content', () => {
    render(
      RootLayout({
        children: <div>app</div>,
      }),
    );

    expect(screen.getByText('app')).toBeDefined();
  });
});
