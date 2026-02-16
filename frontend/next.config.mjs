import path from 'path';
import { fileURLToPath } from 'url';

/** @type {import('next').NextConfig} */
const backendOrigin = (process.env.BACKEND_API_ORIGIN || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, '..'),
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
};

export default nextConfig;
