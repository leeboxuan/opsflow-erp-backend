ALTER TABLE "master_singapore_ports"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'SG',
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "placeId" TEXT;

ALTER TABLE "master_singapore_depots"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'SG',
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "placeId" TEXT;

UPDATE "master_singapore_ports"
SET
  "addressLine1" = CASE "code"
    WHEN 'PPAP' THEN 'Pasir Panjang Terminal Building 3'
    WHEN 'TUAS' THEN 'Tuas Port'
    WHEN 'BRANI' THEN 'Brani Terminal'
    WHEN 'KEPPEL' THEN 'Keppel Distripark'
    WHEN 'JURONG' THEN '37 Jurong Port Road'
    WHEN 'SEMBAWANG' THEN 'Sembawang Wharves'
    ELSE "addressLine1"
  END,
  "addressLine2" = CASE "code"
    WHEN 'PPAP' THEN '25 Harbour Drive'
    WHEN 'TUAS' THEN 'Tuas South Boulevard'
    WHEN 'KEPPEL' THEN '511 Kampong Bahru Road'
    ELSE "addressLine2"
  END,
  "postalCode" = CASE "code"
    WHEN 'PPAP' THEN '117612'
    WHEN 'TUAS' THEN '637236'
    WHEN 'BRANI' THEN '098947'
    WHEN 'KEPPEL' THEN '099447'
    WHEN 'JURONG' THEN '619110'
    WHEN 'SEMBAWANG' THEN '757700'
    ELSE "postalCode"
  END,
  "country" = COALESCE("country", 'SG'),
  "lat" = CASE "code"
    WHEN 'PPAP' THEN 1.27526
    WHEN 'TUAS' THEN 1.23974
    WHEN 'BRANI' THEN 1.26290
    WHEN 'KEPPEL' THEN 1.27354
    WHEN 'JURONG' THEN 1.30841
    WHEN 'SEMBAWANG' THEN 1.46295
    ELSE "lat"
  END,
  "lng" = CASE "code"
    WHEN 'PPAP' THEN 103.76456
    WHEN 'TUAS' THEN 103.62582
    WHEN 'BRANI' THEN 103.84580
    WHEN 'KEPPEL' THEN 103.84129
    WHEN 'JURONG' THEN 103.70813
    WHEN 'SEMBAWANG' THEN 103.81237
    ELSE "lng"
  END
WHERE "code" IN ('PPAP', 'TUAS', 'BRANI', 'KEPPEL', 'JURONG', 'SEMBAWANG');

UPDATE "master_singapore_depots"
SET
  "addressLine1" = CASE "code"
    WHEN 'GUL7' THEN '7 Gul Circle'
    WHEN 'GUL_DEFAULT' THEN '7 Gul Circle'
    WHEN 'TUAS_DEPOT' THEN '15 Tuas Avenue 18'
    WHEN 'PASIR_DEPOT' THEN '30 Pasir Panjang Road'
    ELSE "addressLine1"
  END,
  "postalCode" = CASE "code"
    WHEN 'GUL7' THEN '629563'
    WHEN 'GUL_DEFAULT' THEN '629563'
    WHEN 'TUAS_DEPOT' THEN '638898'
    WHEN 'PASIR_DEPOT' THEN '118503'
    ELSE "postalCode"
  END,
  "country" = COALESCE("country", 'SG'),
  "lat" = CASE "code"
    WHEN 'GUL7' THEN 1.30995
    WHEN 'GUL_DEFAULT' THEN 1.30995
    WHEN 'TUAS_DEPOT' THEN 1.32545
    WHEN 'PASIR_DEPOT' THEN 1.28124
    ELSE "lat"
  END,
  "lng" = CASE "code"
    WHEN 'GUL7' THEN 103.65573
    WHEN 'GUL_DEFAULT' THEN 103.65573
    WHEN 'TUAS_DEPOT' THEN 103.64648
    WHEN 'PASIR_DEPOT' THEN 103.78309
    ELSE "lng"
  END
WHERE "code" IN ('GUL7', 'GUL_DEFAULT', 'TUAS_DEPOT', 'PASIR_DEPOT');
