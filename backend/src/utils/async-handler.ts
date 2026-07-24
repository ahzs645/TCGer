import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { ParsedQs } from 'qs';

export const asyncHandler =
  <
    Params = ParamsDictionary,
    ResBody = unknown,
    ReqBody = any,
    ReqQuery = ParsedQs
  >(
    handler: (
      req: Request<Params, ResBody, ReqBody, ReqQuery>,
      res: Response<ResBody>
    ) => Promise<void | Response<ResBody>>
  ) =>
  async (req: Request<Params, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
