import type { CategoryDto, CategoryKind } from '@ledger/shared';
import { api } from '@/lib/api';

export const categoriesApi = {
  list: (kind?: CategoryKind) =>
    api.get<{ data: CategoryDto[] }>('/categories', kind === undefined ? {} : { kind }),
};
