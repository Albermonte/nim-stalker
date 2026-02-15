/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nim-stalker/shared'],
  output: 'standalone',
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  experimental: {
    optimizePackageImports: ['cytoscape', '@nimiq/utils'],
  },
};

module.exports = nextConfig;
