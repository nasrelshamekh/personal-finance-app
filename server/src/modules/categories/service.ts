import type { Category, CategoryKind, Prisma } from '@prisma/client';
import type {
  CategoryDto,
  CreateCategoryInput,
  DeleteCategoryResponse,
  UpdateCategoryInput,
} from '@ledger/shared';
import { AppError } from '../../lib/errors';
import type { Db } from '../../lib/fx';

type CountsById = Map<string, number>;

async function transactionCounts(db: Db, ids: string[]): Promise<CountsById> {
  if (ids.length === 0) return new Map();

  const grouped = await db.transaction.groupBy({
    by: ['categoryId'],
    where: { categoryId: { in: ids } },
    _count: { _all: true },
  });

  return new Map(
    grouped
      .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
      .map((row) => [row.categoryId, row._count._all]),
  );
}

function toDto(category: Category, counts: CountsById, children: CategoryDto[]): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    kind: category.kind,
    color: category.color,
    icon: category.icon,
    parentId: category.parentId,
    isArchived: category.isArchived,
    children,
    transactionCount: counts.get(category.id) ?? 0,
  };
}

/**
 * Tree-shaped on GET (SPEC §7). Nesting is one level deep, so this is a single grouping
 * pass rather than a recursive walk — and if a second level ever appeared in the data,
 * it would be visible here rather than silently flattened.
 */
export async function listCategories(
  db: Db,
  options: { kind?: CategoryKind; includeArchived: boolean },
): Promise<CategoryDto[]> {
  const where: Prisma.CategoryWhereInput = {
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.includeArchived ? {} : { isArchived: false }),
  };

  const categories = await db.category.findMany({
    where,
    orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
  });

  const counts = await transactionCounts(
    db,
    categories.map((category) => category.id),
  );

  const childrenByParent = new Map<string, Category[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }

  return categories
    .filter((category) => category.parentId === null)
    .map((parent) =>
      toDto(
        parent,
        counts,
        (childrenByParent.get(parent.id) ?? []).map((child) => toDto(child, counts, [])),
      ),
    );
}

export async function getCategory(db: Db, id: string): Promise<CategoryDto> {
  const category = await db.category.findUnique({ where: { id }, include: { children: true } });
  if (!category) throw AppError.notFound('That category does not exist.');

  const ids = [category.id, ...category.children.map((child) => child.id)];
  const counts = await transactionCounts(db, ids);

  return toDto(
    category,
    counts,
    category.children.map((child) => toDto(child, counts, [])),
  );
}

/**
 * Enforces the one-level nesting rule the schema cannot express (SPEC §5): a parent must
 * itself be a root, and a category's kind must match its parent's.
 */
async function assertValidParent(
  db: Db,
  parentId: string,
  kind: CategoryKind,
  selfId?: string,
): Promise<void> {
  if (selfId !== undefined && parentId === selfId) {
    throw AppError.unprocessable('A category cannot be its own parent.', { field: 'parentId' });
  }

  const parent = await db.category.findUnique({ where: { id: parentId } });
  if (!parent) {
    throw AppError.unprocessable('That parent category does not exist.', { field: 'parentId' });
  }
  if (parent.parentId !== null) {
    throw AppError.unprocessable(
      `${parent.name} is already a sub-category. Categories nest one level only.`,
      { field: 'parentId' },
    );
  }
  if (parent.kind !== kind) {
    throw AppError.unprocessable(
      `A ${kind.toLowerCase()} category cannot sit under ${parent.name}, which is ${parent.kind.toLowerCase()}.`,
      { field: 'parentId' },
    );
  }

  if (selfId !== undefined) {
    const childCount = await db.category.count({ where: { parentId: selfId } });
    if (childCount > 0) {
      throw AppError.unprocessable(
        'This category has sub-categories of its own, so it cannot become one.',
        { field: 'parentId' },
      );
    }
  }
}

export async function createCategory(db: Db, input: CreateCategoryInput): Promise<CategoryDto> {
  if (input.parentId !== null) {
    await assertValidParent(db, input.parentId, input.kind);
  }

  const category = await db.category.create({
    data: {
      name: input.name,
      kind: input.kind,
      color: input.color,
      icon: input.icon,
      parentId: input.parentId,
    },
  });

  return getCategory(db, category.id);
}

export async function updateCategory(
  db: Db,
  id: string,
  input: UpdateCategoryInput,
): Promise<CategoryDto> {
  const existing = await db.category.findUnique({ where: { id } });
  if (!existing) throw AppError.notFound('That category does not exist.');

  if (input.parentId !== undefined && input.parentId !== null) {
    await assertValidParent(db, input.parentId, existing.kind, id);
  }

  await db.category.update({
    where: { id },
    data: {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.isArchived === undefined ? {} : { isArchived: input.isArchived }),
    },
  });
  return getCategory(db, id);
}

/**
 * Archives rather than deletes when anything still refers to the category — the same rule
 * accounts follow, for the same reason: deleting it would either orphan history or take
 * history with it, and both rewrite past figures.
 */
export async function deleteCategory(db: Db, id: string): Promise<DeleteCategoryResponse> {
  const category = await db.category.findUnique({ where: { id } });
  if (!category) throw AppError.notFound('That category does not exist.');

  const [transactionCount, budgetCount, childCount] = await Promise.all([
    db.transaction.count({ where: { categoryId: id } }),
    db.budget.count({ where: { categoryId: id } }),
    db.category.count({ where: { parentId: id } }),
  ]);

  if (transactionCount > 0 || budgetCount > 0 || childCount > 0) {
    await db.category.update({ where: { id }, data: { isArchived: true } });
    return { outcome: 'archived', category: await getCategory(db, id) };
  }

  const dto = await getCategory(db, id);
  await db.category.delete({ where: { id } });
  return { outcome: 'deleted', category: dto };
}

/** Used by the transaction service, which must reject a mismatched or archived category. */
export async function requireUsableCategory(
  db: Db,
  id: string,
  expectedKind: CategoryKind,
): Promise<Category> {
  const category = await db.category.findUnique({ where: { id } });
  if (!category) {
    throw AppError.unprocessable('That category does not exist.', { field: 'categoryId' });
  }
  if (category.isArchived) {
    throw AppError.unprocessable(`${category.name} is archived.`, { field: 'categoryId' });
  }
  if (category.kind !== expectedKind) {
    throw AppError.unprocessable(
      `${category.name} is an ${category.kind.toLowerCase()} category, so it cannot be used on an ${expectedKind.toLowerCase()}.`,
      { field: 'categoryId' },
    );
  }
  return category;
}
