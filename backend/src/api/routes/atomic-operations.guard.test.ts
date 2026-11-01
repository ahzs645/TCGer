jest.mock('../../config/env', () => ({ env: { BACKEND_MODE: 'hybrid' } }));
import { env } from '../../config/env';
import { requireAtomicInventoryProvider } from './atomic-operations.guard';

test('legacy operations stop before a handler can change inventory or finance', () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  env.BACKEND_MODE = 'hybrid';
  requireAtomicInventoryProvider({} as never, res as never, next);
  expect(res.status).toHaveBeenCalledWith(501);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'ATOMIC_OPERATION_UNAVAILABLE' }));
  expect(next).not.toHaveBeenCalled();
  env.BACKEND_MODE = 'convex';
  requireAtomicInventoryProvider({} as never, res as never, next);
  expect(next).toHaveBeenCalledTimes(1);
});
