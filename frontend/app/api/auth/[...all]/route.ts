export const dynamic = 'force-static';

export function generateStaticParams() {
  return [];
}

const convexSiteUrl =
  process.env.CONVEX_SITE_URL_INTERNAL ??
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  'http://127.0.0.1:3211';

const publicSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

async function proxy(request: Request) {
  const requestUrl = new URL(request.url);
  const targetUrl = `${convexSiteUrl}${requestUrl.pathname}${requestUrl.search}`;
  const proxiedRequest = new Request(targetUrl, request);
  const publicUrl = new URL(publicSiteUrl);

  proxiedRequest.headers.set('accept-encoding', 'identity');
  proxiedRequest.headers.set('host', publicUrl.host);
  proxiedRequest.headers.set('x-forwarded-host', publicUrl.host);
  proxiedRequest.headers.set('x-forwarded-proto', publicUrl.protocol.replace(/:$/, ''));

  return fetch(proxiedRequest, {
    method: request.method,
    redirect: 'manual'
  });
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}
