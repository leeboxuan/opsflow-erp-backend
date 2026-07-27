-- Additive only: introduce TRANSPORT_STAFF alongside deprecated OPS.
-- Do NOT drop OPS in this migration.
ALTER TYPE "Role" ADD VALUE 'TRANSPORT_STAFF';