# ADR 0004: Use SQLite and OS-Native Local Storage

## Status

Accepted.

### v1 Implementation Notes

- The migration system is `CREATE TABLE IF NOT EXISTS` only. There is no
  version tracking, no `ALTER TABLE` support, and no pre-migration backup or
  snapshot.

## Context

The runtime needs durable local state for sessions, task groups, tasks, events,
artifacts, metrics, retries, validation failures, and retention policies. It
also needs filesystem storage for logs, diffs, result files, and arbitrary
artifacts.

The storage layout must work on macOS and Linux without polluting project repos
by default.

## Decision

Use SQLite for daemon state and filesystem storage for logs and artifacts.
Use direct `better-sqlite3` access with handwritten SQL migrations and small
repository modules in v1.

Store runtime data in OS-native app directories by default. See
`docs/design/storage-layout.md` for the exact macOS and Linux paths.

## Rationale

SQLite fits a local daemon that needs durable queues, append-only events,
queryable aggregation, state transitions, and metrics without requiring a
server database. Filesystem storage is a better fit for large logs, patches,
screenshots, recordings, and arbitrary artifacts.

OS-native app directories follow platform expectations, keep project repos
clean, and make pruning cache/logs safer than a single mixed dot-directory.

## Consequences

- The daemon must run automatic forward migrations on startup and create a
  backup or snapshot before migrating.
- Downgrades and destructive migrations are not automatic in v1.
- Prompts, briefs, logs, and artifacts are stored as plaintext local data by
  default and must be documented clearly.
- Project-local storage can exist as an explicit override for tests or portable
  demos, but it is not the default.
