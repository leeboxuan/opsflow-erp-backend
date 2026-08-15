-- READ-ONLY preflight for 20260815120000_users_username_global_unique.
-- Do not run as a Prisma migration. Execution against UAT/production is blocked
-- pending authorization. If any of the first three queries return rows, the
-- unique index will fail (or leave invalid blanks). Do not rewrite usernames here.

-- 1) Exact stored duplicates
SELECT username, COUNT(*) AS n, array_agg(id) AS user_ids
FROM users
WHERE username IS NOT NULL
GROUP BY username
HAVING COUNT(*) > 1;

-- 2) Normalized duplicates (same contract as login / unique index)
SELECT
  lower(regexp_replace(username, '[[:space:]]+', '', 'g')) AS normalized,
  COUNT(*) AS n,
  array_agg(id) AS user_ids,
  array_agg(username) AS stored_usernames
FROM users
WHERE username IS NOT NULL
  AND length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) > 0
GROUP BY 1
HAVING COUNT(*) > 1;

-- 3) Blank / whitespace-only usernames
SELECT id, username
FROM users
WHERE username IS NOT NULL
  AND length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) = 0;

-- 4) Non-canonical stored values (valid identity, but not persisted canonical form)
SELECT id, username, lower(regexp_replace(username, '[[:space:]]+', '', 'g')) AS normalized
FROM users
WHERE username IS NOT NULL
  AND username <> lower(regexp_replace(username, '[[:space:]]+', '', 'g'));

-- 5) Invalid after normalize (fails JS assertValidUsername charset/length)
SELECT id, username, lower(regexp_replace(username, '[[:space:]]+', '', 'g')) AS normalized
FROM users
WHERE username IS NOT NULL
  AND length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) > 0
  AND (
    length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) < 2
    OR length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) > 64
    OR lower(regexp_replace(username, '[[:space:]]+', '', 'g'))
         !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
  );

-- 6) Affected memberships + driver profiles for normalized collisions
WITH collisions AS (
  SELECT lower(regexp_replace(username, '[[:space:]]+', '', 'g')) AS normalized
  FROM users
  WHERE username IS NOT NULL
    AND length(lower(regexp_replace(username, '[[:space:]]+', '', 'g'))) > 0
  GROUP BY 1
  HAVING COUNT(*) > 1
)
SELECT
  u.id AS user_id,
  u.username AS stored_username,
  lower(regexp_replace(u.username, '[[:space:]]+', '', 'g')) AS normalized,
  m.id AS membership_id,
  m."tenantId" AS tenant_id,
  m.role AS legacy_role,
  d.id AS driver_id
FROM users u
JOIN collisions c
  ON c.normalized = lower(regexp_replace(u.username, '[[:space:]]+', '', 'g'))
LEFT JOIN tenant_memberships m ON m."userId" = u.id
LEFT JOIN drivers d ON d."userId" = u.id
ORDER BY normalized, u.id;
