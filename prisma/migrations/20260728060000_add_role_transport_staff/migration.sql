-- Additive only: introduce TRANSPORT_STAFF alongside deprecated OPS.
-- Do NOT drop OPS in this migration.
-- Created for a future controlled apply — do not apply to hosted DB from this task.
ALTER TYPE "Role" ADD VALUE 'TRANSPORT_STAFF';
