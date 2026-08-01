jest.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    BACKEND_MODE: 'convex',
  },
}));

import { env } from '../../config/env';
import { getHealthResponse } from './health.router';

const mockedEnv = env as typeof env & { BACKEND_MODE: 'hybrid' | 'convex' };

describe('getHealthResponse', () => {
  test('reports Convex-native feature availability', () => {
    mockedEnv.BACKEND_MODE = 'convex';

    expect(getHealthResponse()).toEqual({
      status: 'ok',
      env: 'test',
      mode: 'convex',
      features: {
        decks: true,
        finance: true,
        sealed: true,
        analytics: true,
        trades: true,
        prices: false,
        notifications: false,
        alerts: false,
        shops: false,
        automations: false,
        shipments: false,
        public: true,
      },
    });
  });

  test('reports every feature in hybrid mode', () => {
    mockedEnv.BACKEND_MODE = 'hybrid';

    expect(getHealthResponse()).toEqual({
      status: 'ok',
      env: 'test',
      mode: 'hybrid',
      features: {
        decks: true,
        finance: true,
        sealed: true,
        analytics: true,
        trades: true,
        prices: true,
        notifications: true,
        alerts: true,
        shops: true,
        automations: true,
        shipments: true,
        public: true,
      },
    });
  });
});
