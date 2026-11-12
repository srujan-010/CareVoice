import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors';

function formatValidationDetails(error: ZodError) {
  const fields = error.flatten().fieldErrors;
  const fieldPaths: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const pathKey = issue.path.length > 0 ? issue.path.join('.') : '_root';
    if (!fieldPaths[pathKey]) {
      fieldPaths[pathKey] = [];
    }
    if (!fieldPaths[pathKey].includes(issue.message)) {
      fieldPaths[pathKey].push(issue.message);
    }
  }

  const summaryParts = Object.entries(fieldPaths)
    .slice(0, 4)
    .map(([key, msgs]) => (key === '_root' ? msgs[0] : `${key}: ${msgs[0]}`));

  return {
    fields,
    fieldPaths,
    summaryMessage:
      summaryParts.length > 0
        ? `Invalid request payload (${summaryParts.join('; ')})`
        : 'Invalid request payload',
  };
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formatted = formatValidationDetails(result.error);
      next(
        new ValidationError(formatted.summaryMessage, {
          fields: formatted.fields,
          fieldPaths: formatted.fieldPaths,
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
      const formatted = formatValidationDetails(result.error);
      next(
        new ValidationError(formatted.summaryMessage, {
          fields: formatted.fields,
          fieldPaths: formatted.fieldPaths,
        })
      );
      return;
    }
    (req as Request & { validatedQuery?: T }).validatedQuery = result.data;
    next();
  };
}

