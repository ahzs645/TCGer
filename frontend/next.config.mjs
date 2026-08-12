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

// The shared booster pack lives in the packages/pack-core submodule and is
// consumed as TypeScript source, so Next has to compile it rather than treat it
// as a prebuilt dependency the way @tcg/api-types is.
const packCore = path.join(__dirname, '..', 'packages', 'pack-core', 'src', 'index.ts');

const nextConfig = {
  distDir,
  env: {
    NEXT_PUBLIC_DEMO_EXPORT: isDemoExport ? 'true' : 'false'
  },
  outputFileTracingRoot: path.join(__dirname, '..'),
  transpilePackages: ['@tcg/pack-core'],
  // @huggingface/transformers (client-side embedding scanner) conditionally
  // requires Node-only packages. Exclude them from the browser bundle so the
  // ONNX Runtime Web (WASM/WebGPU) path is used instead.
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      'onnxruntime-node$': false,
      // Resolve the submodule straight to its source, so a fresh clone needs only
      // `git submodule update` rather than an npm install to link the workspace.
      '@tcg/pack-core': packCore,
    };
    return config;
  },
  // Turbopack (default bundler since Next 16) equivalent of the webpack
  // aliases above.
  turbopack: {
    resolveAlias: {
      sharp: './src/lib/empty-module.js',
      'onnxruntime-node': './src/lib/empty-module.js',
      '@tcg/pack-core': '../packages/pack-core/src/index.ts',
    },
  },
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
