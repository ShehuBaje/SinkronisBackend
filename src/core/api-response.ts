import type { Response } from "express";

export type PaginationMetadata = { page: number; limit: number; total: number; totalPages: number };

export const sendSuccess = (res: Response, message: string, data: unknown, options?: { status?: number; metadata?: Record<string, unknown>; pagination?: PaginationMetadata }) =>
  res.status(options?.status ?? 200).json({ success: true, message, data, ...(options?.metadata ? { metadata: options.metadata } : {}), ...(options?.pagination ? { pagination: options.pagination } : {}) });
