import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new ValidationError('Invalid request payload', {
          fields: result.error.flatten().fieldErrors,
        })
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new ValidationError('Invalid query parameters', {
          fields: result.error.flatten().fieldErrors,
        })
      );
      return;
    }
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}

