SELECT migration_name, finished_at IS NOT NULL AS finished
FROM "_prisma_migrations"
WHERE migration_name = '20260817140000_onboarding_idempotency_records';

SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'idempotency_records'
ORDER BY ordinal_position;

SELECT indexname FROM pg_indexes WHERE tablename = 'idempotency_records';
