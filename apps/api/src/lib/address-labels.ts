import { ADDRESS_BOOK } from '@nim-stalker/shared/address-book';
import { formatAddress } from './address-utils';

const VALIDATORS_API_URL = 'https://validators-api-mainnet.pages.dev/api/v1/validators';
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

interface ValidatorInfo {
  name: string;
  logo: string | null;
  accentColor: string;
}

class AddressLabelService {
  private validators = new Map<string, ValidatorInfo>();
  private refreshInterval: Timer | null = null;

  async initialize(options?: { startupTimeoutMs?: number; refreshTimeoutMs?: number }): Promise<void> {
    const startupTimeoutMs = options?.startupTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const refreshTimeoutMs = options?.refreshTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

    await this.fetchValidators(startupTimeoutMs);
    this.refreshInterval = setInterval(() => {
      this.fetchValidators(refreshTimeoutMs).catch((err) => {
        console.warn('[AddressLabelService] Failed to refresh validators:', err);
      });
    }, REFRESH_INTERVAL_MS);
  }

  private async fetchValidators(timeoutMs: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(VALIDATORS_API_URL, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: Array<{
        address: string;
        name: string;
        logo: string | null;
        accentColor: string;
        hasDefaultLogo: boolean;
      }> = await response.json();

      const newMap = new Map<string, ValidatorInfo>();
      for (const validator of data) {
        const formatted = formatAddress(validator.address);
        newMap.set(formatted, {
          name: validator.name,
          logo: validator.hasDefaultLogo ? null : validator.logo,
          accentColor: validator.accentColor,
        });
      }

      this.validators = newMap;
      console.log(`[AddressLabelService] Loaded ${newMap.size} validators`);
    } catch (err) {
      console.warn('[AddressLabelService] Failed to fetch validators:', err);
      // Keep stale data if we had any
    } finally {
      clearTimeout(timeout);
    }
  }

  getLabel(address: string): string | null {
    const formatted = formatAddress(address);

    // Priority: validators API > address book
    const validator = this.validators.get(formatted);
    if (validator) return validator.name;

    const bookLabel = ADDRESS_BOOK[formatted];
    if (bookLabel) return bookLabel;

    return null;
  }

  getIcon(address: string): string | null {
    const formatted = formatAddress(address);
    return this.validators.get(formatted)?.logo ?? null;
  }

  dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

// Singleton
let service: AddressLabelService | null = null;

export function getAddressLabelService(): AddressLabelService {
  if (!service) {
    service = new AddressLabelService();
  }
  return service;
}

/** Reset singleton — only for testing */
export function _resetAddressLabelService(): void {
  if (service) {
    service.dispose();
    service = null;
  }
}
