import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE = /^[A-Za-z0-9._-]{1,64}$/;

/** Gives every request an X-Request-Id (reuses a safe incoming one) and echoes it on the response. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && SAFE.test(incoming) ? incoming : randomUUID();
  (req as Request & { id?: string }).id = id;
  res.setHeader('X-Request-Id', id);
  next();
}