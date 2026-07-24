import type { NextFunction, Request, Response } from 'express';
import { errorHandler } from './error-handler';

describe('errorHandler configuration errors', () => {
  it('returns a clear, safe APITCG configuration response', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const request = {
      log: { error: jest.fn(), warn: jest.fn() }
    } as unknown as Request;
    const response = { status } as unknown as Response;
    const error = Object.assign(
      new Error(
        'Dragon Ball Super is not configured: APITCG_API_KEY is required to use this provider'
      ),
      { status: 503, code: 'APITCG_NOT_CONFIGURED' }
    );

    errorHandler(error, request, response, jest.fn() as NextFunction);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: 'APITCG_NOT_CONFIGURED',
      message: expect.stringContaining('APITCG_API_KEY'),
      details: undefined
    });
  });

  it('continues to hide ordinary upstream 5xx details', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const request = {
      log: { error: jest.fn(), warn: jest.fn() }
    } as unknown as Request;

    errorHandler(
      Object.assign(new Error('provider secret detail'), { status: 502 }),
      request,
      { status } as unknown as Response,
      jest.fn() as NextFunction
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal server error' })
    );
  });
});
