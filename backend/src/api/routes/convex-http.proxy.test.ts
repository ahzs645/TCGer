import type { Request } from 'express';

import { env } from '../../config/env';
import type { AuthRequest } from '../middleware/auth';
import { buildAuthProxyHeaders, buildProxyHeaders } from './convex-http.proxy';

function requestWithHeaders(values: Record<string, string>): Request {
  return {
    header: (name: string) => values[name.toLowerCase()]
  } as Request;
}

describe('Convex HTTP proxy headers', () => {
  it('adds the server-side bridge secret and session-derived identity', () => {
    const request = requestWithHeaders({
      accept: 'application/json',
      'x-tcger-bridge-key': 'attacker-controlled-value'
    }) as AuthRequest;
    request.user = {
      id: 'session-user',
      email: 'session@example.com',
      username: 'session-name',
      isAdmin: false,
      showCardNumbers: true,
      showPricing: true
    };

    const headers = buildProxyHeaders(request);

    expect(headers.get('x-tcger-bridge-key')).toBe(env.TCGER_BRIDGE_SECRET);
    expect(headers.get('x-tcger-bridge-key')).not.toBe('attacker-controlled-value');
    expect(headers.get('x-tcger-user-id')).toBe('session-user');
    expect(headers.get('authorization')).toBe('Bearer convex-http-proxy');
  });

  it('does not add bridge credentials to the public Better Auth proxy', () => {
    const headers = buildAuthProxyHeaders(
      requestWithHeaders({
        authorization: 'Bearer browser-session',
        cookie: 'better-auth.session_token=test'
      })
    );

    expect(headers.has('x-tcger-bridge-key')).toBe(false);
    expect(headers.get('authorization')).toBe('Bearer browser-session');
    expect(headers.get('cookie')).toBe('better-auth.session_token=test');
  });

  it('does not manufacture a trusted Origin for requests without one', () => {
    const previousOrigin = env.APP_ORIGIN;
    env.APP_ORIGIN = 'https://trusted-web.example';
    try {
      const headers = buildAuthProxyHeaders(requestWithHeaders({
        host: 'api.example', cookie: 'better-auth.session_token=test'
      }));
      expect(headers.has('origin')).toBe(false);
      expect(headers.get('x-forwarded-host')).toBe('trusted-web.example');
    } finally {
      env.APP_ORIGIN = previousOrigin;
    }
  });

  it.each(['https://configured-api.example', 'https://untrusted.example', 'null'])(
    'preserves incoming Origin %s for Better Auth to validate, including account aliases',
    origin => {
      const previousOrigin = env.APP_ORIGIN;
      env.APP_ORIGIN = 'https://trusted-web.example';
      try {
        for (const [method, originalUrl] of [
          ['POST', '/auth/sign-in/email'],
          ['POST', '/users/me/change-password'],
          ['DELETE', '/users/me']
        ]) {
          const request = Object.assign(requestWithHeaders({ origin }), { method, originalUrl });
          expect(buildAuthProxyHeaders(request).get('origin')).toBe(origin);
        }
      } finally {
        env.APP_ORIGIN = previousOrigin;
      }
    }
  );
});
