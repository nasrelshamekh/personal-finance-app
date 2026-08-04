import { useQuery } from '@tanstack/react-query';
import type { CategoryDto, CategoryKind } from '@ledger/shared';
import { categoriesApi } from './api';

export const categoryKeys = {
  all: ['categories'] as const,
  list: (kind?: CategoryKind) => [...categoryKeys.all, 'list', kind ?? 'all'] as const,
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
