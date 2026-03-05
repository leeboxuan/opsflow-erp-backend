/**
 * Shared constants for list/query DTOs and pagination.
 * Single source of truth to avoid duplication across modules.
 */

/** Allowed sort direction values for list endpoints. */
export const SORT_DIR_VALUES = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIR_VALUES)[number];

/** Pagination defaults for list endpoints (aligned with common/pagination). */
export const DEFAULT_LIST_PAGE = 1;
export const DEFAULT_LIST_PAGE_SIZE = 20;
export const MAX_PAGE = 100;
export const MAX_PAGE_SIZE = 100;
