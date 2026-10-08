import type { Options } from 'pino-http';

export const httpLogOptions: Options = {
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-tcger-bridge-key"]', 'res.headers["set-cookie"]'],
};
