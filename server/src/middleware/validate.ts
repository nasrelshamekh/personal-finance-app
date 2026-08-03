import type { Request, RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../lib/errors';

/**
 * Validates and *replaces* the request parts with their parsed values, so handlers work
 * with coerced types (numbers, dates) rather than raw strings.
 *
 * Throwing the ZodError is deliberate: Express 5 forwards it to the error middleware,
 * which turns it into field-level messages (SPEC §10 wants inline errors, not toasts).
 */
export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export interface Validated<S extends ValidationSchemas> {
  body: S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown;
  query: S['query'] extends ZodTypeAny ? z.infer<S['query']> : unknown;
  params: S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown;
}

/**
 * Reads the `:id` path parameter.
 *
 * Express 5 types `req.params[k]` as `string | string[] | undefined`, which a route with
 * a single `:id` segment can never actually be. This narrows it with a real check rather
 * than a cast, so a routing mistake surfaces as a 400 instead of `undefined` reaching a
 * database query.
 */
export function pathId(req: Request): string {
  const { id } = req.params;
  if (typeof id !== 'string') {
    throw AppError.badRequest('This route needs an id in the path.');
  }
  return id;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    if (schemas.query) {
      // Express 5 makes req.query a getter-only property, so it is redefined rather
      // than assigned.
      Object.defineProperty(req, 'query', {
        value: schemas.query.parse(req.query),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }
    next();
  };
}
