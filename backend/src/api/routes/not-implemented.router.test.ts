import type { Response } from 'express';

import { notImplementedHandler } from './not-implemented.router';

describe('notImplementedHandler', () => {
  it('returns the explicit Convex-backend 501 payload', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const handler = notImplementedHandler('alerts');

    handler({} as never, { status } as unknown as Response, jest.fn());

    expect(status).toHaveBeenCalledWith(501);
    expect(json).toHaveBeenCalledWith({
      error: 'NOT_IMPLEMENTED',
      message: 'alerts is not available on the Convex backend yet'
    });
  });
});
