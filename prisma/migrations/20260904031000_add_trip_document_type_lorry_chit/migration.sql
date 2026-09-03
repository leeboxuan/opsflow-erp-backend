-- Additive TripDocumentType values for Lorry Chit + its signature artifact.
-- SOURCE ONLY — DO NOT APPLY from this agent session.
-- Enum expand only; does not rewrite existing TripDocumentRequirement rows.

ALTER TYPE "TripDocumentType" ADD VALUE IF NOT EXISTS 'LORRY_CHIT';
ALTER TYPE "TripDocumentType" ADD VALUE IF NOT EXISTS 'LORRY_CHIT_SIGNATURE';
