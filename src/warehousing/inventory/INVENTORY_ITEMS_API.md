# GET /inventory/items – Mobile CreateOrderScreen

Response: `InventoryItemDto[]` with `id`, `sku`, `name`, `reference`, `availableQty`.

## UI behavior (mobile)

- **Search results:** Show **Available qty** for each inventory item (not only when the item is selected).
- **Add button:** Disable when `availableQty <= 0`.
- **+1 button:** Disable when selected line `quantity >= availableQty`.

`availableQty` is the count of units in `Available` status (no reserve/dispatch/deliver logic change).
