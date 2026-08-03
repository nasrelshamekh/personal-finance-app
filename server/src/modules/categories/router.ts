import { Router } from 'express';
import type { CreateCategoryInput, UpdateCategoryInput } from '@ledger/shared';
import type { CategoryKind } from '@prisma/client';
import { prisma } from '../../prisma';
import { pathId, validate } from '../../middleware/validate';
import {
  createCategorySchema,
  idParamSchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './schema';
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from './service';

export const categoriesRouter: Router = Router();

/** Tree-shaped: roots with their children nested one level (SPEC §7). */
categoriesRouter.get('/', validate({ query: listCategoriesQuerySchema }), async (req, res) => {
  const query = req.query as unknown as { kind?: CategoryKind; includeArchived: boolean };
  res.json({
    data: await listCategories(prisma, {
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      includeArchived: query.includeArchived,
    }),
  });
});

categoriesRouter.post('/', validate({ body: createCategorySchema }), async (req, res) => {
  const body = req.body as CreateCategoryInput;
  res.status(201).json(await createCategory(prisma, body));
});

categoriesRouter.get('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await getCategory(prisma, pathId(req)));
});

categoriesRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateCategorySchema }),
  async (req, res) => {
    const body = req.body as UpdateCategoryInput;
    res.json(await updateCategory(prisma, pathId(req), body));
  },
);

categoriesRouter.delete('/:id', validate({ params: idParamSchema }), async (req, res) => {
  res.json(await deleteCategory(prisma, pathId(req)));
});
