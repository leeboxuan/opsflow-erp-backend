# Phase 5 — Trip dispatch sequence

## Purpose

Separate **driver-day Dispatch ordering** from **job-local trip sequencing** and **route editing concurrency**.

| Field | Domain |
|-------|--------|
| `Trip.tripSequence` / `Trip.jobSequence` | Job-local order / display refs |
| `Trip.routeVersion` | Trip route/details editing |
| `Trip.dispatchSequence` | Dispatch Route Planning day order |
| `Trip.dispatchVersion` | Dispatch plan optimistic concurrency |

## Safe order

1. Apply only when explicitly requested (not from agent sessions by default).
2. No backfill required — nullable `dispatchSequence` means “unordered until planned”.
3. Application writes `dispatchSequence` + increments `dispatchVersion` on Dispatch save only.

## Do not

- Write `tripSequence` / `jobSequence` from Dispatch planning.
- Use `routeVersion` as the Dispatch concurrency token.
