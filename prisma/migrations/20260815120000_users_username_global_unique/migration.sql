-- Global uniqueness for login usernames after the same canonicalization as
-- JavaScript normalizeUsername (trim + lowercase + strip whitespace).
--
-- JS:  String(raw).trim().toLowerCase().replace(/\s+/g, '')
-- PG:  lower(regexp_replace("username", '[[:space:]]+', '', 'g'))
--
-- Equivalence (must collide): Driver.One / driver.one ; "driver one" / driverone ;
-- leading/trailing whitespace variants.
--
-- Unicode: JS \s includes NBSP and some Unicode Zs; POSIX [[:space:]] is locale
-- POSIX whitespace (typically ASCII). Not claimed perfectly equivalent.
--
-- Partial unique index: NULL usernames are excluded (email-only staff).
-- Empty/whitespace-only stored values are also excluded from the index and must
-- be cleaned via preflight.sql — they are not valid logins.
-- Does not rewrite existing rows. CREATE UNIQUE INDEX fails if normalized
-- collisions exist (transaction rolls back). NOT APPLIED in this pass.

DROP INDEX IF EXISTS "users_username_idx";
DROP INDEX IF EXISTS "users_username_key";

CREATE UNIQUE INDEX "users_username_normalized_key"
ON "users" (lower(regexp_replace("username", '[[:space:]]+', '', 'g')))
WHERE "username" IS NOT NULL
  AND length(lower(regexp_replace("username", '[[:space:]]+', '', 'g'))) > 0;
