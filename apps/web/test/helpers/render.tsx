/**
 * Custom render helper with providers for testing React components
 */

import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

interface WrapperProps {
  children: React.ReactNode;
}

/**
 * Default wrapper with common providers
 * Add providers here as needed (e.g., theme, i18n)
 */
function DefaultWrapper({ children }: WrapperProps) {
  return <>{children}</>;
}

/**
 * Custom render function with providers
 */
function customRender(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();

  return {
    ...render(ui, { wrapper: DefaultWrapper, ...options }),
    user,
  };
}

/**
 * Render with custom wrapper
 */
function renderWithWrapper(
  ui: React.ReactElement,
  Wrapper: React.ComponentType<WrapperProps>,
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();

  return {
    ...render(ui, { wrapper: Wrapper, ...options }),
    user,
  };
}

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override render with custom version
export { customRender as render, renderWithWrapper };
