# Ops Jobs + Driver Jobs – cURL test list

Assume:
- `BASE=http://localhost:3001/api` (app uses global prefix `api`; adjust port if needed)
- `JWT_OPS` = access token for an Ops/Admin user (after login with `X-Tenant-Id: <tenantId>`)
- `JWT_DRIVER` = access token for a Driver user
- `TENANT_ID` = your tenant id
- `COMPANY_ID` = existing customer_companies id
- `DRIVER_USER_ID` = User id of a driver (same tenant)
- `VEHICLE_ID` = optional Vehicle id (same tenant)

Headers used below:
- `Authorization: Bearer <token>`
- `X-Tenant-Id: <tenantId>`
- `Content-Type: application/json` (except multipart)

---

## 1. Ops: Create job (Draft)

```bash
curl -s -X POST "$BASE/ops/jobs" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jobType": "LCL",
    "customerCompanyId": "'"$COMPANY_ID"'",
    "pickupAddress1": "123 Pickup St",
    "deliveryAddress1": "456 Delivery Ave",
    "receiverName": "Jane Doe",
    "receiverPhone": "+6598765432"
  }'
```

Save returned `id` as `JOB_ID`.

---

## 2. Ops: List jobs

```bash
curl -s "$BASE/ops/jobs?limit=20" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

With filters:

```bash
curl -s "$BASE/ops/jobs?status=Draft&companyId=$COMPANY_ID&pickupDateFrom=2025-01-01&pickupDateTo=2025-12-31&limit=50" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 3. Ops: Get one job

```bash
curl -s "$BASE/ops/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 4. Ops: Update job

```bash
curl -s -X PATCH "$BASE/ops/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "receiverPhone": "+6598765433",
    "pickupContactName": "John"
  }'
```

---

## 5. Ops: Assign driver

```bash
curl -s -X POST "$BASE/ops/jobs/$JOB_ID/assign" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "driverId": "'"$DRIVER_USER_ID"'",
    "vehicleId": "'"$VEHICLE_ID"'"
  }'
```

Omit `vehicleId` to use driver’s default vehicle.

---

## 6. Ops: Upload quotation

```bash
curl -s -X POST "$BASE/ops/jobs/$JOB_ID/documents/quotation" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -F "file=@/path/to/quotation.pdf"
```

---

## 7. Ops: List job documents

```bash
curl -s "$BASE/ops/jobs/$JOB_ID/documents" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 8. Ops: Job audit log

```bash
curl -s "$BASE/ops/jobs/$JOB_ID/audit?limit=50" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 9. Ops: Job tracking

```bash
curl -s "$BASE/ops/jobs/$JOB_ID/tracking" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 10. Ops: Cancel job (only if not Completed)

```bash
curl -s -X POST "$BASE/ops/jobs/$JOB_ID/cancel" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Customer requested cancellation" }'
```

---

## 11. Ops: Delete job (only Draft or unassigned Assigned)

```bash
curl -s -X DELETE "$BASE/ops/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 12. Ops: Verify depot (IMPORT/EXPORT, PendingDepot → Completed)

```bash
curl -s -X POST "$BASE/ops/jobs/$JOB_ID/verify-depot" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

## 13. Ops: Excel import – preview (no DB writes)

```bash
curl -s -X POST "$BASE/ops/jobs/import/preview" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -F "file=@/path/to/jobs.xlsx"
```

Returns `{ rows: [{ rowNumber, data, errors[], customerCompanyId?, driverId? }] }`. Fix errors in UI, then confirm.

Excel column order (index-based): 0=companyCode/companyId, 1=jobType, 2=pickupAddress, 3=deliveryAddress, 4=receiverName, 5=receiverPhone, 6=pickupDate, 7=driverEmail (optional). If the first row looks like headers (e.g. contains "company", "job type"), it is skipped.

## 14. Ops: Excel import – confirm (create Draft jobs)

```bash
curl -s -X POST "$BASE/ops/jobs/import/confirm" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {
        "companyCode": "acme corp",
        "jobType": "LCL",
        "pickupAddress": "123 Pickup St",
        "deliveryAddress": "456 Delivery Ave",
        "receiverName": "Jane Doe",
        "receiverPhone": "+6598765432",
        "pickupDate": "2025-03-10",
        "rowNumber": 2
      }
    ]
  }'
```

Returns `{ createdCount, failedRows: [{ rowNumber, reason }] }`. Required fields: companyCode or companyId, jobType, pickupAddress, deliveryAddress, receiverName, receiverPhone, pickupDate. Optional: driverEmail (resolved to driverId if valid DRIVER in tenant).

---

## Driver endpoints (use JWT_DRIVER)

### 15. Driver: List my jobs for date (default today)

```bash
curl -s "$BASE/drivers/jobs?date=2025-03-06" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

### 16. Driver: Get one job

```bash
curl -s "$BASE/drivers/jobs/$JOB_ID" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

### 17. Driver: Start job

```bash
curl -s -X POST "$BASE/drivers/jobs/$JOB_ID/start" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID"
```

---

### 18. Driver: Update location

```bash
curl -s -X POST "$BASE/drivers/jobs/$JOB_ID/location" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{ "lat": 1.3521, "lng": 103.8198 }'
```

---

### 19. Driver: Upload POD photo(s)

```bash
curl -s -X POST "$BASE/drivers/jobs/$JOB_ID/pod/photos" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -F "files=@/path/to/photo1.jpg" \
  -F "files=@/path/to/photo2.jpg"
```

---

### 20. Driver: Upload POD signature

```bash
curl -s -X POST "$BASE/drivers/jobs/$JOB_ID/pod/signature" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -F "file=@/path/to/signature.png"
```

---

### 21. Driver: Complete job (POD + signature required)

```bash
curl -s -X POST "$BASE/drivers/jobs/$JOB_ID/complete" \
  -H "Authorization: Bearer $JWT_DRIVER" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{ "recipientName": "Jane Doe" }'
```

For LCL → status becomes Completed. For IMPORT/EXPORT → PendingDepot (then Ops calls verify-depot).
