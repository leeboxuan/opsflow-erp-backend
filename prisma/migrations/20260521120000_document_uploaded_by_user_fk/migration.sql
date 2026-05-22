-- Link job/trip document uploaders to users for API name/email resolution.
ALTER TABLE "job_documents"
  ADD CONSTRAINT "job_documents_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "trip_documents"
  ADD CONSTRAINT "trip_documents_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
