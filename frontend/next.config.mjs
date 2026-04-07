import path from 'path';
import { fileURLToPath } from 'url';

/** @type {import('next').NextConfig} */
const isDemoExport = process.env.DEMO_EXPORT === 'true';
const backendOrigin = (process.env.BACKEND_API_ORIGIN || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3004').replace(/\/$/, '');
const localBackendProxyPath = process.env.LOCAL_BACKEND_PROXY_PATH
  ? `/${process.env.LOCAL_BACKEND_PROXY_PATH.replace(/^\/+|\/+$/g, '')}`
  : '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.NEXT_DIST_DIR || '.next';

const nextConfig = {
  distDir,
  outputFileTracingRoot: path.join(__dirname, '..'),
  ...(isDemoExport
    ? {
        output: 'export',
        trailingSlash: true,
        basePath: process.env.BASE_PATH || '',
        images: { unoptimized: true }
      }
    : {
        images: {
          remotePatterns: [
            {
              protocol: 'https',
              hostname: '**'
            }
          ]
        },
        async rewrites() {
          const rewrites = [
            {
              source: '/health',
              destination: `${backendOrigin}/health`
            },
          ];

          if (localBackendProxyPath) {
            rewrites.push({
              source: `${localBackendProxyPath}/:path*`,
              destination: `${backendOrigin}/:path*`,
            });
          }

          return rewrites;
        }
      })
};

export default nextConfig;
