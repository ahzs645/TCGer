import path from 'path';
import { fileURLToPath } from 'url';

/** @type {import('next').NextConfig} */
const isDemoExport = process.env.DEMO_EXPORT === 'true';
const backendOrigin = (process.env.BACKEND_API_ORIGIN || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
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
          return [
            {
              source: '/api/:path*',
              destination: `${backendOrigin}/:path*`
            },
            {
              source: '/auth/:path*',
              destination: `${backendOrigin}/auth/:path*`
            },
            {
              source: '/health',
              destination: `${backendOrigin}/health`
            }
          ];
        }
      })
};

export default nextConfig;
