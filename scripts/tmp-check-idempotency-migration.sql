SELECT migration_name, finished_at, rolled_back_at, LEFT(logs, 200) AS logs
FROM "_prisma_migrations"
WHERE migration_name LIKE '%idempotency%';

SELECT to_regclass('public.idempotency_records') AS idempotency_table;
SELECT to_regtype('public."IdempotencyRecordStatus"') AS idempotency_enum;
