# Jobs + Audit migration

## Prisma schema diff summary

- **Job** model: id, tenantId, customerCompanyId, internalRef, **externalRef** (optional), jobType (LCL|IMPORT|EXPORT), status (Draft|Assigned|...), **notes** (optional), pickup/delivery/receiver fields, assignedDriverId, assignedVehicleId, ... Indexes on tenantId+internalRef, tenantId+customerCompanyId, tenantId+status, tenantId+pickupDate, tenantId+assignedDriverId.

- **JobDocument** model: id, tenantId, jobId, type (QUOTATION|DO|POD_PHOTO|SIGNATURE|OTHER), storageKey, originalName, mimeType, sizeBytes, uploadedByUserId, createdAt. Indexes on tenantId+jobId, tenantId+type.

- **AuditLog** model: id, tenantId, actorUserId, entityType, entityId, action, metadata (Json), createdAt. Indexes on tenantId+entityType+entityId, tenantId+createdAt.

- **job_internal_ref_counters** model: tenantId, yyyymm, nextSeq (compound PK tenantId+yyyymm). Used to generate JOB-YYYYMM-0001 style refs.

- **drivers** table: added **defaultVehicleId** (optional FK to Vehicle). Index on tenantId+defaultVehicleId.

- **Vehicle** model: added relation `driversDefault drivers[]` for drivers with this as default vehicle.

- **Tenant**: added relations jobs, jobDocuments, jobInternalRefCounters, auditLogs.

- **User**: added relation jobsAssigned (Job.assignedDriverId).

- **customer_companies**: added relation jobs (JobCustomerCompany).

## Migration command

From project root (with `.env` or `.env.local` containing `DATABASE_URL` and `DIRECT_URL`):

```bash
npx prisma migrate dev --name add_jobs_audit_driver_vehicle
```

Or for production deploy:

```bash
npx prisma migrate deploy
```

Then regenerate the client if needed:

```bash
npx prisma generate
```

## Supabase storage

Create a bucket **job-documents** (or the name used in code: `JOB_DOCUMENTS_BUCKET`) in your Supabase project with policies that allow your app (service role or authenticated users) to upload and read. Path pattern: `{tenantId}/jobs/{jobId}/quotation|pod-photos|signatures/...`

## Excel import (preview → confirm)

- **POST /ops/jobs/import/preview** – Upload Excel; returns parsed rows with validation errors and resolved `customerCompanyId` / `driverId`. No DB writes.
- **POST /ops/jobs/import/confirm** – Send JSON `{ rows: [...] }` (from preview, possibly edited); server validates again, creates Draft jobs, returns `{ createdCount, failedRows }`.

**Validation rules:** Required: companyCode or companyId, jobType (LCL|IMPORT|EXPORT), pickupAddress, deliveryAddress, receiverName, receiverPhone, pickupDate. Company is resolved by: companyId (cuid) or companyCode (matched to customer company normalized name). Optional: driverEmail (resolved to driverId if a DRIVER in the tenant).

**Excel column order (index-based):** 0=companyCode/companyId, 1=jobType, 2=pickupAddress, 3=deliveryAddress, 4=receiverName, 5=receiverPhone, 6=pickupDate, 7=driverEmail (optional). If the first row looks like headers, it is skipped.
