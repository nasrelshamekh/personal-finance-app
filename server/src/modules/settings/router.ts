import { Router } from 'express';
import type { UpdateSettingsInput } from '@ledger/shared';
import { prisma } from '../../prisma';
import { validate } from '../../middleware/validate';
import { updateSettingsSchema } from './schema';
import { readSettings, writeSettings } from './service';

export const settingsRouter: Router = Router();

settingsRouter.get('/', async (_req, res) => {
  res.json(await readSettings(prisma));
});

settingsRouter.put('/', validate({ body: updateSettingsSchema }), async (req, res) => {
  const body = req.body as UpdateSettingsInput;
  res.json(await writeSettings(prisma, body));
});
