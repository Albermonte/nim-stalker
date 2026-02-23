import { ValidationUtils } from '@nimiq/utils';
import { ADDRESS_BOOK } from '@nim-stalker/shared/address-book';

export interface AddressLabelOption {
  label: string;
  address: string;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function normalizeAddress(address: string): string {
  return address.replace(/\s/g, '').toUpperCase();
}

export const LABEL_TO_ADDRESS = new Map<string, string>();
export const LABEL_OPTIONS: AddressLabelOption[] = [];

for (const [address, label] of Object.entries(ADDRESS_BOOK)) {
  const normalized = normalizeLabel(label);
  if (LABEL_TO_ADDRESS.has(normalized)) continue;
  LABEL_TO_ADDRESS.set(normalized, address);
  LABEL_OPTIONS.push({ label, address });
}

export function resolveAddressInput(input: string): { address: string | null; error: string | null } {
  const raw = input.trim();
  if (!raw) {
    return { address: null, error: 'Please enter an address' };
  }

  const fromLabel = LABEL_TO_ADDRESS.get(normalizeLabel(raw));
  if (fromLabel) {
    return { address: normalizeAddress(fromLabel), error: null };
  }

  const normalizedAddress = normalizeAddress(raw);
  if (!ValidationUtils.isValidAddress(normalizedAddress)) {
    return { address: null, error: 'Invalid Nimiq address format' };
  }

  return { address: normalizedAddress, error: null };
}
