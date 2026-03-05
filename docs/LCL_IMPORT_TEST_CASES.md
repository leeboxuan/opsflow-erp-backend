# LCL Order In import – test cases (grouping by Order Ref)

These cases can be run via the spec file `src/ops/lcl-import.spec.ts` once Jest is configured for TypeScript (e.g. ts-jest), or verified manually via the API.

---

## Case 1: Multiple rows with same Order Ref → one job

**Input (Excel):** Two data rows with the same "Order Ref" = `ORD-001`.

| Order Ref | First Name | Last Name | Phone   | Mobile   | Delivery First Name | Delivery Last Name | Delivery Address 1  | ... | Item Code      | Item Qty | Special Request   |
|-----------|------------|-----------|---------|----------|---------------------|--------------------|---------------------|-----|----------------|----------|-------------------|
| ORD-001   | John       | Doe       | 65123456| 91234567 | Jane                | Doe                | 123 Delivery St     | ... | LLSG-CB-Q-DGY  | 2        | Handle with care  |
| ORD-001   | John       | Doe       | 65123456| 91234567 | Jane                | Doe                | 123 Delivery St     | ... | LLSG-CB-S-DGY  | 1        | Fragile           |

**Expected preview:**

- `rows.length === 1`
- `row.rowKey === "ORD-001"`, `row.externalRef === "ORD-001"`
- `row.receiverName === "Jane Doe"`, `row.receiverPhone === "91234567"`
- `row.deliveryAddress1 === "123 Delivery St"`
- `row.itemsSummary` contains `"LLSG-CB-Q-DGY x2"` and `"LLSG-CB-S-DGY x1"`
- `row.specialRequest` contains both "Handle with care" and "Fragile" (e.g. joined by " | ")
- `row.errors === []`
- `stats.total === 1`, `stats.valid === 1`, `stats.invalid === 0`

---

## Case 2: Different Order Refs → one job per Order Ref

**Input:** Two rows with Order Ref `ORD-A` and `ORD-B`.

**Expected preview:**

- `rows.length === 2`
- `rowKey` values are `"ORD-A"` and `"ORD-B"`
- Each row has its own delivery/receiver and aggregated items/special request for that Order Ref.
- `stats.total === 2`

---

## Case 3: Missing delivery/receiver → invalid row

**Input:** One row with Order Ref `ORD-EMPTY` but empty Delivery Address 1, empty Delivery First/Last Name, empty Phone/Mobile.

**Expected preview:**

- `rows.length === 1`
- `row.errors.length > 0`
- Errors mention at least `deliveryAddress1` and `receiverName` (and `receiverPhone` if no default)
- `stats.valid === 0`, `stats.invalid === 1`

---

## cURL examples

**Preview (multipart):**

```bash
curl -s -X POST "$BASE/ops/jobs/import/lcl/preview" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -F "file=@Order In Template.xlsx" \
  -F "customerCompanyId=$COMPANY_ID" \
  -F "pickupDate=2025-03-10" \
  -F "pickupAddress1=456 Pickup Ave" \
  -F "pickupContactPhone=61234567"
```

**Confirm (JSON):**

```bash
curl -s -X POST "$BASE/ops/jobs/import/lcl/confirm" \
  -H "Authorization: Bearer $JWT_OPS" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "customerCompanyId": "'"$COMPANY_ID"'",
    "pickupDate": "2025-03-10",
    "pickupAddress1": "456 Pickup Ave",
    "rows": [
      {
        "rowKey": "ORD-001",
        "externalRef": "ORD-001",
        "receiverName": "Jane Doe",
        "receiverPhone": "91234567",
        "deliveryAddress1": "123 Delivery St",
        "deliveryAddress2": "Unit 4",
        "deliveryPostal": "123456",
        "deliveryCity": "Singapore",
        "deliveryCountry": "SG",
        "itemsSummary": "LLSG-CB-Q-DGY x2; LLSG-CB-S-DGY x1",
        "specialRequest": "Handle with care | Fragile"
      }
    ]
  }'
```

Response: `{ createdCount, failedRows: [{ rowKey, reason }], created: [{ id, internalRef, externalRef }] }`.
