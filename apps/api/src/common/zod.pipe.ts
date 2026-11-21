import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from './errors';

/** Validates a body/query/param with a zod schema. Usage: @Body(new ZodPipe(MySchema)) */
export class ZodPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return result.data;
  }
}