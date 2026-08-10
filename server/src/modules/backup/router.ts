import { Router } from 'express';
import type { ImportRequest, ResetRequest } from '@ledger/shared';
import { prisma } from '../../prisma';
import { env } from '../../env';
import { validate } from '../../middleware/validate';
import { importRequestSchema, resetRequestSchema } from './schema';
import { exportAll, importBackup, resetAll } from './service';

export const backupRouter: Router = Router();

/**
 * The dump is served as a download rather than a bare JSON body: the whole point is a
 * file on disk you can put somewhere safe, and making the browser name it correctly is
 * the difference between a backup and a tab full of text.
 */
backupRouter.get('/export', async (_req, res) => {
  const backup = await exportAll(prisma);
  const stamp = backup.exportedAt.slice(0, 10);

  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="ledger-eg-${stamp}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

backupRouter.post('/import', validate({ body: importRequestSchema }), async (req, res) => {
  const { backup, dryRun } = req.body as ImportRequest;
  const report = await importBackup(prisma, backup, dryRun, env.BACKUP_DIR);

  // A dry run that found problems is a successful inspection, not a failed import — the
  // report is the answer, so it is a 200 either way and `applied` says what happened.
  res.json(report);
});

backupRouter.post('/reset', validate({ body: resetRequestSchema }), async (req, res) => {
  const { restoreStarterData } = req.body as ResetRequest;
  res.json(await resetAll(prisma, restoreStarterData, env.BACKUP_DIR));
});
