import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { prisma } from '../../prisma';

/**
 * HTTP contract only — semantics are covered in service.test.ts and resolve.test.ts.
 * These run against the real database rather than a transaction, so anything written is
 * tracked and removed afterwards.
 */
const app = createApp({ corsOrigins: ['http://localhost:5173'], requestLogging: false });

const createdRateIds: string[] = [];

afterAll(async () => {
  if (createdRateIds.length > 0) {
    await prisma.exchangeRate.deleteMany({ where: { id: { in: createdRateIds } } });
  }
  await prisma.$disconnect();
});

describe('GET /api/fx/rates', () => {
  it('returns a resolved rate per foreign currency', async () => {
    // `refresh=false` keeps this test off the network: with automatic rates on, the
    // default path would fetch for real once the seeded rates age past 30h.
    const res = await request(app).get('/api/fx/rates').query({ refresh: 'false' });

    expect(res.status).toBe(200);
    expect(res.body.rates).toHaveLength(3);
    expect(typeof res.body.apiEnabled).toBe('boolean');
    expect(res.body.autoRefresh).toBe('DISABLED');

    for (const rate of res.body.rates) {
      expect(rate.quote).toBe('EGP');
      // Money and rates cross the wire as strings, never floats (SPEC §4.2).
      expect(typeof rate.rate).toBe('string');
      expect(typeof rate.stale).toBe('boolean');
      expect(typeof rate.asOf).toBe('string');
    }
  });
});

describe('GET /api/fx/rates/stored', () => {
  it('returns the raw rows behind those figures', async () => {
    const res = await request(app).get('/api/fx/rates/stored');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const row of res.body.data) {
      expect(typeof row.rate).toBe('string');
      expect(['MANUAL', 'API']).toContain(row.source);
    }
  });
});

describe('GET /api/fx/convert', () => {
  it('converts and reports the rate it used', async () => {
    const res = await request(app)
      .get('/api/fx/convert')
      .query({ amount: '500', from: 'USD', to: 'EGP' });

    expect(res.status).toBe(200);
    expect(res.body.from).toBe('USD');
    expect(res.body.to).toBe('EGP');
    expect(typeof res.body.result).toBe('string');
    expect(res.body.rate.derivation).toBeTruthy();
  });

  it('evaluates an arithmetic expression in the amount', async () => {
    const res = await request(app)
      .get('/api/fx/convert')
      .query({ amount: '1200*3+450', from: 'EGP', to: 'EGP' });

    expect(res.status).toBe(200);
    expect(res.body.amount).toBe('4050.0000');
    expect(res.body.result).toBe('4050.0000');
  });

  it('rejects a broken expression inline, pointing at the field', async () => {
    const res = await request(app)
      .get('/api/fx/convert')
      .query({ amount: '(1200*3', from: 'USD', to: 'EGP' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toMatchObject({ field: 'amount', code: 'UnbalancedParen' });
  });

  it('rejects an unknown currency with field-level detail', async () => {
    const res = await request(app)
      .get('/api/fx/convert')
      .query({ amount: '500', from: 'JPY', to: 'EGP' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'from' })]),
    );
  });

  it('rejects a missing amount', async () => {
    const res = await request(app).get('/api/fx/convert').query({ from: 'USD', to: 'EGP' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('PUT /api/fx/manual', () => {
  it('stores a typed rate', async () => {
    const asOf = new Date('2026-08-03T21:30:00.000Z').toISOString();
    const res = await request(app)
      .put('/api/fx/manual')
      .send({ base: 'USD', quote: 'EGP', rate: '53.2500', asOf });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('MANUAL');
    expect(res.body.rate).toBe('53.25000000');
    expect(res.body.nextUpdateAt).toBeNull();

    createdRateIds.push(res.body.id);
  });

  it('refuses a rate of a currency against itself', async () => {
    const res = await request(app)
      .put('/api/fx/manual')
      .send({ base: 'USD', quote: 'USD', rate: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'quote' })]),
    );
  });

  it('refuses a zero or negative rate', async () => {
    for (const rate of ['0', '-5']) {
      const res = await request(app)
        .put('/api/fx/manual')
        .send({ base: 'USD', quote: 'EGP', rate });

      expect(res.status).toBe(400);
    }
  });

  it('refuses a rate sent as a float rather than a string', async () => {
    const res = await request(app)
      .put('/api/fx/manual')
      .send({ base: 'USD', quote: 'EGP', rate: 53.25 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/fx/refresh', () => {
  it('refuses while automatic rates are switched off, and says where to turn them on', async () => {
    const before = await prisma.setting.findUniqueOrThrow({ where: { id: 1 } });

    try {
      await prisma.setting.update({ where: { id: 1 }, data: { ratesApiEnabled: false } });

      const res = await request(app).post('/api/fx/refresh');

      expect(res.status).toBe(422);
      expect(res.body.error.message).toContain('Settings');
      expect(res.body.error.details).toEqual({ setting: 'ratesApiEnabled' });
    } finally {
      // Restore whatever the setting actually was, rather than assuming a default.
      await prisma.setting.update({
        where: { id: 1 },
        data: { ratesApiEnabled: before.ratesApiEnabled },
      });
    }
  });
});
