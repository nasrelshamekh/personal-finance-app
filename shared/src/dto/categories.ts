import { z } from 'zod';
import { categoryKindSchema, type CategoryKind } from '../enums';
import { hexColor, iconName } from './common';

export interface CategoryDto {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  parentId: string | null;
  isArchived: boolean;
  /** Present on the tree-shaped GET; one level deep only. */
  children: CategoryDto[];
  /** How many transactions reference it, so the UI can warn before archiving. */
  transactionCount: number;
}

export const createCategorySchema = z.object({
  name: z.string().min(1, 'Give the category a name.').max(60),
  kind: categoryKindSchema,
  color: hexColor,
  icon: iconName,
  /**
   * One level of nesting only (SPEC §5). Prisma cannot express that, so the service
   * rejects a parent that is itself a child.
   */
  parentId: z.string().uuid().nullable().default(null),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().min(1).max(60),
    color: hexColor,
    icon: iconName,
    parentId: z.string().uuid().nullable(),
    isArchived: z.boolean(),
  })
  .partial();

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesQuerySchema = z.object({
  kind: categoryKindSchema.optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface DeleteCategoryResponse {
  outcome: 'archived' | 'deleted';
  category: CategoryDto;
}
