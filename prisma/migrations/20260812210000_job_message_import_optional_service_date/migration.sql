-- Service date is no longer part of the import review workflow.
-- Requested pickup/delivery times live on reviewed drafts; trips hold execution schedule.
ALTER TABLE "job_message_import_batches" ALTER COLUMN "serviceDate" DROP NOT NULL;
