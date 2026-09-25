# Type Skill — DB changes, Batch jobs & Integrations

Applies on top of the base skill when the PR changes the database (migrations, schema, data
fixes, heavy queries), adds or changes background work (cron, batch, queue worker, Lambda,
scheduled task), or talks to an external system (third-party API, webhook, SSO, file transfer).
Output format, severity and signals are the base skill's.
The question here is **"what happens with real data, at real volume, when things fail halfway?"**

## 1. Migrations and schema

- **Never edit a migration that is already merged/applied** → `[blocker]`. Add a new one.
- Adding `NOT NULL` to a table with data needs a default or a backfill in the right order.
- Dropping or renaming a column/table: is old code (still running during deploy) reading it?
  Safe order is add → migrate code → remove later. Drop not explained by the ticket → `[blocker]`.
- Large tables: index creation / type change that locks the table (use concurrent/online options
  where the database supports them).
- Down/rollback path exists if the codebase writes them.
- Model/entity and migration agree (column names, types, nullability, defaults, enum values).
- Data migration + schema change in one step: wrapped in a transaction, idempotent if re-run.
- Seed/reference data changes are idempotent (upsert, not blind insert).

## 2. Queries and data writes

- `UPDATE`/`DELETE` always has the intended `WHERE` (and tenant scope) → missing is `[blocker]`.
- Multi-step writes that must succeed together are in one transaction.
- Race conditions: "check then insert" without a unique constraint or lock → duplicates.
- Soft delete respected in new queries.
- Query in a loop (N+1) or unbounded `SELECT` on a growing table → `[major]`.
- New filter/sort/join column on a large table probably needs an index — "(verify)".

## 3. Batch jobs and background work

- **Idempotent**: running the job twice (retry, overlap, manual re-run) does not duplicate or
  corrupt data. Uses a processed-marker, upsert, or dedup key.
- **Partial failure**: one bad record does not stop or silently skip the rest; failures are
  collected and reported; the job can resume.
- **Chunking**: large sets processed in pages/batches, not loaded all at once; within platform
  timeouts (e.g. Lambda 15 min) and memory.
- **Concurrency**: two instances at the same time (scaled workers, overlapping cron) — is there a
  lock or is it safe?
- **Schedule**: cron expression and **time zone** match the requirement; schedule changes are
  intentional.
- **Observability**: start/end/count logged without personal data; a failure raises an alert or
  error status — a job that fails and exits 0 is `weak-error-handling` `[major]`.

## 4. External integrations

- Timeouts set on every outbound call → missing is `[major]`.
- Retries only for idempotent operations, with backoff; no infinite retry loops.
- 4xx vs 5xx vs network errors handled differently; rate limits (429) respected.
- External pagination followed to the end; partial pages not treated as complete.
- Tokens/credentials from config/secret store, never hard-coded or logged → `[blocker]`
  `security-risk` if exposed. Token expiry/refresh handled.
- Incoming webhooks: signature/secret verified, replay handled, respond fast and process async.
- Response shape validated before use; missing fields do not crash the whole run.
- Contract change with the other system coordinated (versioning, both sides deployed).

## 5. Config and infrastructure

- New env var / secret / queue / bucket defined for **every** environment, with a safe default.
- Permissions (IAM, DB roles) least-privilege — no `*` actions or public buckets.
- Feature flag or kill switch for risky new jobs, if the codebase uses them.

## 6. Tests expected

- Migrations: at least applied in a test/CI run (visible in the PR) or described.
- Jobs: a test for re-run safety (idempotency) or a failure mid-batch.
- Integrations: external calls mocked for success, error and timeout.
None of these for non-trivial work → `[major]` `tests-missing`.

## 7. Severity calibration

| Situation | Severity |
| --- | --- |
| Edited applied migration; unexplained DROP; UPDATE/DELETE without scope | `[blocker]` |
| Credentials hard-coded or logged; webhook without verification | `[blocker]` |
| Job not idempotent where retries/overlap are possible | `[major]` |
| No timeout on external call; failure exits as success | `[major]` |
| NOT NULL without default/backfill on a populated table | `[major]` (blocker if it will fail on deploy) |
| Missing index on a new filter for a large table | `[minor]` (verify) |

## 8. Examples

- `[blocker] db/migrations/20240101_init.sql:12 — Applied migration edited: column type changed in old file → add a new migration`
- `[major] jobs/syncUsers.js:30 — Not idempotent: re-run inserts duplicates → upsert on external_id`
- `[major] services/crmClient.js:18 — No timeout: axios call can hang the batch → set timeout and handle ECONNABORTED`
