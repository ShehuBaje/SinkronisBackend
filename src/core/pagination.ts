import { z } from "zod";

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional()
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export const getPagination = (query: PaginationQuery) => ({
  skip: (query.page - 1) * query.limit,
  take: query.limit
});
