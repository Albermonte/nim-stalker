import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import RootLayout from './layout';

describe('RootLayout', () => {
  it('renders a GitHub link that opens the repo in a new tab', () => {
    render(
      RootLayout({
        children: <div>app</div>,
      }),
    );

    const link = screen.getByRole('link', {
      name: 'Open repository on GitHub',
    });

    expect(link).toHaveAttribute(
      'href',
      'https://github.com/Albermonte/nim-stalker',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});
