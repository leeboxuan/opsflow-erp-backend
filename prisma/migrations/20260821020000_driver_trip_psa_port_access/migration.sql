-- PSA port-access eligibility (SOURCE ONLY — DO NOT APPLY from agents)
-- Additive boolean flags with safe defaults (false). No backfill invents access.

ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "hasPsaPortAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "requiresPsaPortAccess" BOOLEAN NOT NULL DEFAULT false;
