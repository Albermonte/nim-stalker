const DEV_API_FALLBACK = 'http://localhost:3001';

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function resolveApiBaseUrl(options: {
  envUrl?: string;
  nodeEnv?: string;
  browserOrigin?: string;
} = {}): string {
  const envUrl = options.envUrl?.trim();
  if (envUrl) return trimTrailingSlash(envUrl);

  const browserOrigin = options.browserOrigin?.trim();
  if (browserOrigin) return trimTrailingSlash(browserOrigin);

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (nodeEnv !== 'production') return DEV_API_FALLBACK;

  return '';
}

export function getApiBaseUrl(): string {
  const browserOrigin =
    typeof window !== 'undefined' ? window.location.origin : undefined;

  return resolveApiBaseUrl({
    envUrl: process.env.NEXT_PUBLIC_API_URL,
    nodeEnv: process.env.NODE_ENV,
    browserOrigin,
  });
}
