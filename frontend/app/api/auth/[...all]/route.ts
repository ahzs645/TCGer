export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const configuredConvexSiteUrl =
  process.env.CONVEX_SITE_URL_INTERNAL ??
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  'http://localhost:3211';
const configuredPublicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

async function proxy(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, configuredConvexSiteUrl);
  const headers = new Headers(request.headers);
  const publicUrl = new URL(configuredPublicSiteUrl ?? requestUrl.origin);

  headers.set('accept-encoding', 'identity');
  headers.set('x-forwarded-host', publicUrl.host);
  headers.set('x-forwarded-proto', publicUrl.protocol.replace(/:$/, ''));

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  return fetch(targetUrl, init);
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function HEAD(request: Request) {
  const targetUrl = new URL(request.url);
  const proxiedGet = new Request(targetUrl, {
    headers: request.headers,
    method: 'GET'
  });
  const response = await proxy(proxiedGet);

  return new Response(null, {
    status: response.status,
    headers: response.headers
  });
}

export async function POST(request: Request) {
  return proxy(request);
}
