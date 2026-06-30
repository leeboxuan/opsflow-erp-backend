/**
 * Paginated list endpoints (all return { data: T[], meta: { page, pageSize, total } }).
 *
 * MIGRATED LIST ENDPOINTS & QUERY PARAMS:
 * - GET /api/vehicles                    page, pageSize, q, filter (all|assigned|unassigned), sortBy, sortDir, status?, type?, driverId?
 * - GET /api/ops/jobs                    page, pageSize, search?, status?, companyId?, pickupDateFrom?, pickupDateTo?
 * - GET /api/customers/companies         page, pageSize, search?
 * - GET /api/customers/companies/:id/contacts  page, pageSize, search?
 * - GET /api/admin/users                 page, pageSize
 * - GET /api/admin/vehicles              page, pageSize
 * - GET /api/admin/locations             page, pageSize
 * - GET /api/admin/drivers               page, pageSize
 * - GET /api/transport/orders            page, pageSize
 * - GET /api/transport/trips             page, pageSize
 * - GET /api/inventory/items/summary     page, pageSize, search?
 * - GET /api/inventory/items             page, pageSize, search?
 * - GET /api/inventory/batches           page, pageSize, customerName?, status?
 * - GET /api/inventory/units             page, pageSize, inventoryItemId (required), status?
 * - GET /api/inventory/units/search      page, pageSize, prefix?, search?, itemSku?, status?, batchId?, transportOrderId?  (+ response.stats)
 * - GET /api/finance/invoices            page, pageSize
 * - GET /api/tenants                     page, pageSize  (tenants for current user)
 * - GET /api/tenants/members             page, pageSize
 * - GET /api/drivers/jobs                page, pageSize, date? (YYYY-MM-DD, default today)
 */

/**
 * Standard shape for paginated list responses.
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Parsed pagination params from query (page, pageSize, skip, take).
 * Use with parsePaginationFromQuery().
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}
