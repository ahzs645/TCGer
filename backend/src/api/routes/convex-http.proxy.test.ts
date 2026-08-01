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
});
