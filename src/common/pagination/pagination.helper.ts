import type { PaginationMeta, PaginationParams } from "./pagination.types";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE = 1;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

export interface PaginationQueryInput {
  page?: unknown;
  pageSize?: unknown;
}

/**
 * Parse and normalize pagination from query params.
 * Clamps: page >= 1, pageSize in [1, 100].
 */
export function parsePaginationFromQuery(
  query: PaginationQueryInput,
  defaults: { page?: number; pageSize?: number } = {},
): PaginationParams {
  const page = clampPage(toNumber(query.page, defaults.page ?? DEFAULT_PAGE));
  const pageSize = clampPageSize(
    toNumber(query.pageSize, defaults.pageSize ?? DEFAULT_PAGE_SIZE),
  );
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

/**
 * Build meta object for a paginated response.
 */
export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
  };
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPage(page: number): number {
  return Math.max(MIN_PAGE, Math.floor(page));
}

function clampPageSize(size: number): number {
  const n = Math.floor(size);
  if (n < MIN_PAGE_SIZE) return MIN_PAGE_SIZE;
  if (n > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return n;
}
