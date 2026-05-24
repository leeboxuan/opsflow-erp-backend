-- Wisdom Force / Gul Circle manual trip shortcuts (additive enum values).
ALTER TYPE "JobTripTemplate" ADD VALUE IF NOT EXISTS 'CUSTOMER_TO_GUL';
ALTER TYPE "JobTripTemplate" ADD VALUE IF NOT EXISTS 'GUL_TO_CUSTOMER';
