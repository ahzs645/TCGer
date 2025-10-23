import type { NextFunction, Request, Response } from 'express';

export const asyncHandler =
  <Params = unknown, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
    handler: (req: Request<Params, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>) => Promise<void>
  ) =>
  async (req: Request<Params, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
