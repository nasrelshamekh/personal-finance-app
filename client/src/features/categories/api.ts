import type {
  CategoryDto,
  CategoryKind,
  CreateCategoryInput,
  DeleteCategoryResponse,
  UpdateCategoryInput,
} from '@ledger/shared';
import { api } from '@/lib/api';

export const categoriesApi = {
  list: (kind?: CategoryKind, includeArchived = false) =>
    api.get<{ data: CategoryDto[] }>('/categories', {
      ...(kind === undefined ? {} : { kind }),
      includeArchived: String(includeArchived),
    }),
  create: (body: CreateCategoryInput) => api.post<CategoryDto>('/categories', body),
  update: (id: string, body: UpdateCategoryInput) =>
    api.patch<CategoryDto>(`/categories/${id}`, body),
  remove: (id: string) => api.delete<DeleteCategoryResponse>(`/categories/${id}`),
};
