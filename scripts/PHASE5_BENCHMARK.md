# Phase 5 query benchmark

Local / authorized staging harness for index plan checks. **Does not apply migrations.**

## Safety

- Requires `DATABASE_URL`
- Refuses remote/cloud hosts unless `ALLOW_REMOTE_BENCHMARK=1`
- Never prints connection strings or row payloads
- Default mode is `EXPLAIN` (no `ANALYZE`)

## Usage

```bash
# Against local Postgres only
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/opsflow \
  npx ts-node --transpile-only scripts/phase5-query-benchmark.ts

# Optional synthetic tenant for count probes
DATABASE_URL=... BENCHMARK_TENANT_ID=<uuid> BENCHMARK_MODE=counts \
  npx ts-node --transpile-only scripts/phase5-query-benchmark.ts
```

Do **not** point this at production. Do **not** set `ALLOW_REMOTE_BENCHMARK=1` unless the target is an approved disposable/staging clone.
