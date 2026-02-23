import React from 'react';
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@/test/helpers/render';

const searchAddressMock = mock(async () => {});
const addAddressMock = mock(async () => {});
const getCytoscapeElementsMock = mock(() => ({ nodes: [], edges: [] }));
const routerPushMock = mock(() => {});

let mockStore = {
  searchAddress: searchAddressMock,
  addAddress: addAddressMock,
  loading: false,
  getCytoscapeElements: getCytoscapeElementsMock,
};

mock.module('@/store/graph-store', () => ({
  useGraphStore: () => mockStore,
}));

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: mock(() => {}),
    refresh: mock(() => {}),
    back: mock(() => {}),
    forward: mock(() => {}),
    prefetch: mock(() => Promise.resolve()),
  }),
}));

import { SearchPanel } from './SearchPanel';

describe('SearchPanel autocomplete', () => {
  beforeEach(() => {
    searchAddressMock.mockClear();
    addAddressMock.mockClear();
    getCytoscapeElementsMock.mockClear();
    routerPushMock.mockClear();
    mockStore = {
      searchAddress: searchAddressMock,
      addAddress: addAddressMock,
      loading: false,
      getCytoscapeElements: getCytoscapeElementsMock,
    };
  });

  test('submitting known label in search resolves to mapped address', async () => {
    render(<SearchPanel />);
    const [searchInput] = screen.getAllByRole('textbox');

    fireEvent.change(searchInput, { target: { value: 'Nimiq Sunset Cyberspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(searchAddressMock).toHaveBeenCalledTimes(1));
    expect(searchAddressMock.mock.calls[0][0]).toBe('NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
    expect(routerPushMock).toHaveBeenCalledWith('/address/NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
  });

  test('submitting known label in add node resolves to mapped address', async () => {
    render(<SearchPanel />);
    const [, addInput] = screen.getAllByRole('textbox');

    fireEvent.change(addInput, { target: { value: 'Nimiq Sunset Cyberspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addAddressMock).toHaveBeenCalledTimes(1));
    expect(addAddressMock.mock.calls[0][0]).toBe('NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
  });

  test('can pick suggestion then submit search', async () => {
    render(<SearchPanel />);
    const [searchInput] = screen.getAllByRole('textbox');

    fireEvent.change(searchInput, { target: { value: 'sunset' } });
    const suggestion = await screen.findByText('Nimiq Sunset Cyberspace');
    fireEvent.click(suggestion);

    expect(searchInput).toHaveValue('Nimiq Sunset Cyberspace');

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchAddressMock).toHaveBeenCalledTimes(1));
    expect(searchAddressMock.mock.calls[0][0]).toBe('NQ208P9L3YMDGQYT1TAA8D0GMC125HBQ1Q8A');
  });

  test('invalid non-label input still shows error', async () => {
    render(<SearchPanel />);
    const [searchInput] = screen.getAllByRole('textbox');

    fireEvent.change(searchInput, { target: { value: 'not-a-valid-address-or-label' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Invalid Nimiq address format')).toBeInTheDocument();
    expect(searchAddressMock).not.toHaveBeenCalled();
  });

  test('suggestion list includes Nimiq Sunset Cyberspace', async () => {
    render(<SearchPanel />);
    const [searchInput] = screen.getAllByRole('textbox');

    fireEvent.change(searchInput, { target: { value: 'sunset' } });
    expect(await screen.findByText('Nimiq Sunset Cyberspace')).toBeInTheDocument();
  });
});
