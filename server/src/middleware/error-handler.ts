import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, type ErrorBody } from '../lib/errors';
import { isProduction } from '../env';
import { logger } from '../logger';

/**
 * The single error middleware (SPEC §7).
 *
 * Express 5 propagates rejections from async handlers here automatically — there is no
 * `asyncHandler` wrapper anywhere in this codebase, and there should not be one.
 */

/** Flattens a ZodError into per-field messages the client can attach to inputs. */
function zodDetails(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

function mapError(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
    };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some fields need fixing.',
          details: zodDetails(err),
        },
      },
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique violation -> 409, P2025 record not found -> 404 (SPEC §7).
    if (err.code === 'P2002') {
      const target = err.meta?.['target'];
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'those values');
      return {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: `Something with the same ${fields} already exists.`,
            details: { fields },
          },
        },
      };
    }

    if (err.code === 'P2025') {
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'That record does not exist.' } },
      };
    }

    if (err.code === 'P2003') {
      return {
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'Something else still refers to this record, so it cannot be removed.',
          },
        },
      };
    }
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return {
      status: 400,
      body: { error: { code: 'BAD_JSON', message: 'The request body is not valid JSON.' } },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL',
        message: 'Something broke on the server. The details are in the server log.',
      },
    },
  };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, body } = mapError(err);

  if (status >= 500) {
    logger.error({ err }, 'Unhandled error');
  } else {
    logger.debug({ err: err instanceof Error ? err.message : err, status }, 'Request rejected');
  }

  // Never leak a stack trace in production (SPEC §7). In development it is attached
  // separately so the shape of `error` stays identical in both environments.
  if (!isProduction && err instanceof Error && err.stack) {
    res.status(status).json({ ...body, stack: err.stack.split('\n') });
    return;
  }

  res.status(status).json(body);
};

/** Terminal 404 for unmatched routes. Registered after every router. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}.`,
    },
  } satisfies ErrorBody);
};
