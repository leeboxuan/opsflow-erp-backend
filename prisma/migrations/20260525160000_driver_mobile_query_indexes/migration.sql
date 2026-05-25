-- Driver mobile list/detail query paths (tenant + driver + status + planned day).
CREATE INDEX IF NOT EXISTS "trips_tenant_driver_status_planned_idx"
  ON "trips"("tenantId", "assignedDriverUserId", "status", "plannedStartAt");

-- Trip completion document checks (active docs by trip + type).
CREATE INDEX IF NOT EXISTS "trip_documents_tenant_trip_active_type_idx"
  ON "trip_documents"("tenantId", "tripId", "isActive", "type");
