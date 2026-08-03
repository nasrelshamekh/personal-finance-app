import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from './error-handler';
import { AppError } from '../lib/errors';
import { createApp } from '../app';

/** Mounts a single route that throws whatever the test hands it. */
function appThatThrows(thrown: unknown) {
  const app = express();
  app.use(express.json());
  // Async on purpose: Express 5 forwards the rejection with no asyncHandler (SPEC §7).
  app.get('/boom', async () => {
    throw thrown;
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('error handler', () => {
  it('maps AppError to its status and code', async () => {
    const res = await request(appThatThrows(AppError.notFound())).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'That record does not exist.',
    });
  });

  it('carries AppError details through', async () => {
    const err = AppError.unprocessable('A transaction must match its account currency.', {
      accountCurrency: 'EGP',
      transactionCurrency: 'USD',
    });
    const res = await request(appThatThrows(err)).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.details).toEqual({
      accountCurrency: 'EGP',
      transactionCurrency: 'USD',
    });
  });

  it('turns a ZodError into field-level details, not a flat message', async () => {
    const schema = z.object({ amount: z.string(), currency: z.enum(['EGP', 'USD']) });
    let thrown: unknown;
    try {
      schema.parse({ amount: 12, currency: 'JPY' });
    } catch (err) {
      thrown = err;
    }

    const res = await request(appThatThrows(thrown)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'amount' }),
        expect.objectContaining({ path: 'currency' }),
      ]),
    );
  });

  it('maps Prisma P2002 to 409', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['categoryId', 'month'] },
    });
    const res = await request(appThatThrows(err)).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('categoryId, month');
  });

  it('maps Prisma P2025 to 404', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '6.19.3',
    });
    const res = await request(appThatThrows(err)).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('reports an unknown error as a 500 with no internal detail', async () => {
    const res = await request(appThatThrows(new Error('connection string leaked here'))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(res.body.error)).not.toContain('connection string leaked here');
  });

  it('answers unmatched routes with the same error shape', async () => {
    const res = await request(appThatThrows(new Error('unused'))).get('/no-such-route');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain('/no-such-route');
  });
});

describe('app', () => {
  it('serves health', async () => {
    const app = createApp({ corsOrigins: ['http://localhost:5173'], requestLogging: false });
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('404s an unknown API path in the standard error shape', async () => {
    const app = createApp({ corsOrigins: ['http://localhost:5173'], requestLogging: false });
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
