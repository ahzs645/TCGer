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
        onlineCodes: true,
        finance: true,
        sealed: true,
        analytics: true,
        trades: true,
        prices: true,
        notifications: true,
        alerts: true,
        shops: false,
        automations: true,
        shipments: false,
        public: true,
        atomicSales: true,
        atomicIntake: true,
        tradeSettlement: true,
        linkedAcquisitions: true,
        binderPageRevisionGuards: true,
        emailDelivery: false,
      },
    });
  });

  test('reports legacy browsing separately from unavailable atomic operations', () => {
    mockedEnv.BACKEND_MODE = 'hybrid';

    expect(getHealthResponse()).toEqual({
      status: 'ok',
      env: 'test',
      mode: 'hybrid',
      features: {
        decks: true,
        onlineCodes: true,
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
        atomicSales: false,
        atomicIntake: false,
        tradeSettlement: false,
        linkedAcquisitions: false,
        binderPageRevisionGuards: true,
        emailDelivery: false,
      },
    });
  });
});
