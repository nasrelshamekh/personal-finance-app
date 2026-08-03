import { Router } from 'express';
import { prisma } from '../../prisma';
import { validate } from '../../middleware/validate';
import { fxConvertQuerySchema, fxManualRateSchema } from './schema';
import type { FxConvertQuery, FxManualRateInput } from './schema';
import {
  convertAmount,
  ensureFreshRates,
  listRates,
  listStoredRates,
  refreshRates,
  setManualRate,
} from './service';

/**
 * Thin by design: validate, call the service, return. No Prisma in here (SPEC §3).
 *
 * Express 5 propagates rejections from these async handlers to the error middleware on
 * its own — there is no asyncHandler wrapper and there should not be one (SPEC §7).
 */
export const fxRouter: Router = Router();

/**
 * Latest resolved rate per pair, with age and staleness.
 *
 * Tops rates up automatically first (D12), so simply opening a screen keeps them current
 * and no rate ever has to be typed. Pass `?refresh=false` to read without fetching.
 */
fxRouter.get('/rates', async (req, res) => {
  const at = new Date();
  const outcome =
    req.query['refresh'] === 'false' ? 'DISABLED' : await ensureFreshRates(prisma, at);

  res.json(await listRates(prisma, at, outcome));
});

/** The raw stored rows behind those figures, for the rate table. */
fxRouter.get('/rates/stored', async (_req, res) => {
  res.json({ data: await listStoredRates(prisma) });
});

/** Pull from the API provider. Manual, on a button press — no cron (SPEC §6). */
fxRouter.post('/refresh', async (_req, res) => {
  res.json(await refreshRates(prisma));
});

/** Set a manual rate for a pair. A typed rate is intent, and wins ties. */
fxRouter.put('/manual', validate({ body: fxManualRateSchema }), async (req, res) => {
  const body = req.body as FxManualRateInput;
  res.json(await setManualRate(prisma, body));
});

fxRouter.get('/convert', validate({ query: fxConvertQuerySchema }), async (req, res) => {
  const query = req.query as unknown as FxConvertQuery;
  res.json(
    await convertAmount(prisma, {
      amount: query.amount,
      from: query.from,
      to: query.to,
      ...(query.date === undefined ? {} : { date: query.date }),
    }),
  );
});
