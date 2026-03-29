import type { Request, Response as ExpressResponse } from 'express';

import { env } from '../../config/env';
import type { AuthRequest } from '../middleware/auth';

function buildProxyHeaders(req: AuthRequest) {
  const headers = new Headers();
  const user = req.user;

  if (user) {
    headers.set('Authorization', 'Bearer convex-http-proxy');
    headers.set('X-TCGER-User-Id', user.id);
    headers.set('X-TCGER-User-Email', user.email);

    if (user.username) {
      headers.set('X-TCGER-Username', user.username);
      headers.set('X-TCGER-Name', user.username);
    }
  }

  const accept = req.header('accept');
  if (accept) {
    headers.set('Accept', accept);
  }

  const contentType = req.header('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  return headers;
}

function buildAuthProxyHeaders(req: Request) {
  const headers = new Headers();
  const authorization = req.header('authorization');
  const cookie = req.header('cookie');
  const accept = req.header('accept');
  const contentType = req.header('content-type');
  const origin = req.header('origin');
  const publicSiteUrl = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : null;
  const forwardedHost = publicSiteUrl?.host ?? req.header('host');
  const forwardedProto = publicSiteUrl?.protocol.replace(/:$/, '') ?? req.header('x-forwarded-proto');

  if (authorization) {
    headers.set('Authorization', authorization);
  }
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  if (accept) {
    headers.set('Accept', accept);
  }
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  if (origin) {
    headers.set('Origin', origin);
  } else if (env.APP_ORIGIN) {
    headers.set('Origin', env.APP_ORIGIN);
  }
  if (forwardedHost) {
    headers.set('Host', forwardedHost);
    headers.set('X-Forwarded-Host', forwardedHost);
  }
  if (forwardedProto) {
    headers.set('X-Forwarded-Proto', forwardedProto);
  }

  return headers;
}

function buildProxyBody(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  const contentType = req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return {
      body: req as never,
      duplex: 'half' as const
    };
  }

  if (req.body === undefined) {
    return {};
  }

  return {
    body: JSON.stringify(req.body)
  };
}

function relayProxyResponse(proxyResponse: globalThis.Response, res: ExpressResponse) {
  const contentType = proxyResponse.headers.get('content-type');
  const contentDisposition = proxyResponse.headers.get('content-disposition');
  const location = proxyResponse.headers.get('location');
  const setCookie = proxyResponse.headers.getSetCookie?.() ?? [];

  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  if (contentDisposition) {
    res.setHeader('Content-Disposition', contentDisposition);
  }
  if (location) {
    res.setHeader('Location', location);
  }
  if (setCookie.length > 0) {
    res.setHeader('Set-Cookie', setCookie);
  }

  res.status(proxyResponse.status);
}

export async function proxyToConvexHttp(
  req: AuthRequest,
  res: ExpressResponse,
  targetPath = req.originalUrl
) {
  const targetUrl = new URL(targetPath, env.CONVEX_HTTP_ORIGIN);
  const proxyResponse = await fetch(targetUrl, {
    method: req.method,
    headers: buildProxyHeaders(req),
    ...buildProxyBody(req)
  });

  relayProxyResponse(proxyResponse, res);

  if (proxyResponse.status === 204) {
    res.send();
    return;
  }

  const payload = Buffer.from(await proxyResponse.arrayBuffer());
  res.send(payload);
}

export async function proxyToConvexAuth(
  req: Request,
  res: ExpressResponse,
  targetPath = `/api${req.originalUrl}`
) {
  const targetUrl = new URL(targetPath, env.CONVEX_HTTP_ORIGIN);
  const proxyResponse = await fetch(targetUrl, {
    method: req.method,
    headers: buildAuthProxyHeaders(req),
    redirect: 'manual',
    ...buildProxyBody(req)
  });

  relayProxyResponse(proxyResponse, res);

  if (proxyResponse.status === 204 || proxyResponse.status === 304) {
    res.send();
    return;
  }

  const payload = Buffer.from(await proxyResponse.arrayBuffer());
  res.send(payload);
}
