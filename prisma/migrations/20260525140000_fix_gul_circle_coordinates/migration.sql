-- Correct 7 Gul Circle coordinates (OSM: Keppel Gul Circle Districenter, 7 Gul Circle).
-- Legacy values (1.30995, 103.65573) plotted near water on Google Maps.

UPDATE "master_logistics_locations"
SET
  "lat" = 1.3107274,
  "lng" = 103.6749418,
  "addressLine1" = '7 Gul Circle',
  "postalCode" = '629563',
  "name" = '7 Gul Circle (default)',
  "label" = '7 Gul Circle'
WHERE "code" = 'GUL7_DEPOT';

UPDATE "master_singapore_depots"
SET
  "lat" = 1.3107274,
  "lng" = 103.6749418,
  "addressLine1" = '7 Gul Circle',
  "postalCode" = '629563'
WHERE "code" IN ('GUL7', 'GUL_DEFAULT');

-- Repair trips created with legacy Gul Circle depot coordinates.
UPDATE "trips"
SET
  "destinationLat" = 1.3107274,
  "destinationLng" = 103.6749418
WHERE "jobTripTemplate" = 'CUSTOMER_TO_GUL'
  AND "destinationLat" = 1.30995
  AND "destinationLng" = 103.65573;

UPDATE "trips"
SET
  "originLat" = 1.3107274,
  "originLng" = 103.6749418
WHERE "jobTripTemplate" = 'GUL_TO_CUSTOMER'
  AND "originLat" = 1.30995
  AND "originLng" = 103.65573;
