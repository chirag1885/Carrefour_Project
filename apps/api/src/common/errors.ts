import { HttpException } from '@nestjs/common';

/** Every API error has the shape { code, message, details } (see docs/openapi.yaml, Error schema). */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
  ) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details: unknown = null) => new AppError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new AppError(401, code, message);
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);