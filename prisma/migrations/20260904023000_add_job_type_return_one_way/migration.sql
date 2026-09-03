-- Additive JobType + JobMessageImportMovementType values for RETURN / ONE_WAY.
-- SOURCE ONLY — DO NOT APPLY from this agent session.
-- Safe PostgreSQL enum expand (new values only; no rewrites of existing rows).

ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'RETURN';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'ONE_WAY';

ALTER TYPE "JobMessageImportMovementType" ADD VALUE IF NOT EXISTS 'RETURN';
ALTER TYPE "JobMessageImportMovementType" ADD VALUE IF NOT EXISTS 'ONE_WAY';
