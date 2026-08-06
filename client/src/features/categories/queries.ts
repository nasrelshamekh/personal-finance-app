import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CategoryDto,
  CategoryKind,
  CreateCategoryInput,
  UpdateCategoryInput,
} from '@ledger/shared';
import { dashboardKeys, transactionKeys } from '@/features/transactions/queries';
import { categoriesApi } from './api';

export const categoryKeys = {
  all: ['categories'] as const,
  list: (kind?: CategoryKind) => [...categoryKeys.all, 'list', kind ?? 'all'] as const,
  tree: (includeArchived: boolean) => [...categoryKeys.all, 'tree', includeArchived] as const,
};

/** Flattens the tree into a pickable list, keeping children under their parent. */
function flatten(nodes: CategoryDto[]): Array<CategoryDto & { depth: number }> {
  const out: Array<CategoryDto & { depth: number }> = [];
  for (const node of nodes) {
    out.push({ ...node, depth: 0 });
    for (const child of node.children) out.push({ ...child, depth: 1 });
  }
  return out;
}

export function useCategories(kind?: CategoryKind) {
  return useQuery({
    queryKey: categoryKeys.list(kind),
    queryFn: () => categoriesApi.list(kind),
    select: ({ data }) => flatten(data),
  });
}

/** The nested shape, for the management screen — which needs the tree, not a flat list. */
export function useCategoryTree(includeArchived: boolean) {
  return useQuery({
    queryKey: categoryKeys.tree(includeArchived),
    queryFn: () => categoriesApi.list(undefined, includeArchived),
    select: ({ data }) => data,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: categoryKeys.all });
    // A renamed or archived category changes how existing rows read.
    void queryClient.invalidateQueries({ queryKey: transactionKeys.all });
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };
}

export function useCreateCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateCategoryInput) => categoriesApi.create(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCategoryInput }) =>
      categoriesApi.update(id, body),
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: invalidate,
  });
}
