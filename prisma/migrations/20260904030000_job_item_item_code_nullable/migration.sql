-- Allow Collection JobItems to persist without a container number.
-- SOURCE ONLY — DO NOT APPLY from this agent session.
-- Additive nullability only; existing itemCode values are left unchanged.

ALTER TABLE "job_items" ALTER COLUMN "itemCode" DROP NOT NULL;
