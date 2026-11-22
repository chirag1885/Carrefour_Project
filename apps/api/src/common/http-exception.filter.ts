import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './errors';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

interface ErrorBody {
  code: string;
  message: string;
  details: unknown;
}

/** Converts every thrown error into the contract's { code, message, details } body. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    let status = 500;
    let body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Internal server error', details: null };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = exception.getResponse() as ErrorBody;
    } else if (exception instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: CODE_BY_STATUS[status] ?? 'ERROR',
        message: Array.isArray(message) ? message.join('; ') : message,
        details: null,
      };
    } else if (this.clientErrorStatus(exception)) {
      // e.g. malformed JSON from body-parser
      status = this.clientErrorStatus(exception)!;
      body = { code: CODE_BY_STATUS[status] ?? 'BAD_REQUEST', message: 'Malformed request', details: null };
    } else {
      this.log.error(`${req.method} ${req.originalUrl} -> unhandled error`, exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json(body);
  }

  private clientErrorStatus(e: unknown): number | null {
    const s = (e as { status?: unknown; statusCode?: unknown })?.status ?? (e as { statusCode?: unknown })?.statusCode;
    return typeof s === 'number' && s >= 400 && s < 500 ? s : null;
  }
}