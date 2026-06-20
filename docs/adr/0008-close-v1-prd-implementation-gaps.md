# ADR 0008: Close v1 PRD Implementation Gaps

## Status

Accepted. Portions superseded by [ADR-0009](./0009-v1-close-out-adapter-boundary.md)
(control-plane permission validation scope, security presets implementation timing,
token/cost budget enforcement, attempt-level infra retry).

## Context

A code-versus-PRD audit (Issue #1, 80 user stories) confirmed the deterministic
core of vertical slices 1–5 is solid: SQLite persistence, isolated worktrees,
the task runner/supervisor, MCP tools, the CLI, the fake adapter, and the Codex
adapter all work, with 78 passing tests and a clean `tsc --noEmit`.

The audit also found a coherent band of unimplemented PRD requirements. A
grilling session scoped **all** of them into v1 (rather than deferring any to
v2) and resolved the load-bearing design forks. This ADR records that scope and
those decisions so later work does not re-litigate them.

The gaps, by PRD user story:

- Daemon restart recovery (25)
- Hidden local paths in `get_task_result` (32)
- Native skill discovery + read-only skill-path mounts (49, 50, 52)
- Best-effort secret/path redaction (57, 58, 75, 76)
- Bounded limits beyond a single global concurrency cap + priority inheritance
  (7, 8)
- Deterministic duplicate-task warnings (9)
- Revision-override and merge-conflict events/artifacts (38, 46)
- Export-only session bundles + Cursor MCP setup snippet (60, 61, 73)
- Local-only metrics (67)
- Forward DB migrations with backup (66)
- Per-attempt requested/effective model and reasoning recording (16)
- Sandbox/permission/network policy enforcement and recording (17, 18, 19, 77)
- Preflight refusal of dirty source repos

## Decision

Close every gap above in v1 with the designs below. Build **quick-wins first**:
`get_task_result` path hiding → merge/override events → restart recovery →
redaction → limits + priority → migrations → metrics → export → skills.

1. **Restart recovery (25).** On daemon boot, scan the store: transition every
   attempt left in `running` to `interrupted` (terminal — no automatic rerun;
   the orchestrator decides retry) and re-enqueue every `queued` task.

2. **MCP path hiding (32).** `get_task_result` must strip `worktree_path`,
   `log_path`, and `result_path` from the returned attempt, mirroring the
   existing artifact path hiding. The CLI continues to show paths (Story 33).

3. **Skills (49, 50, 52).** Subagents inherit the host environment so the
   adapter's native global/user skill discovery works without interception.
   Configured `skill_paths` are mounted **read-only**: symlink by default, copy
   opt-in; external absolute paths require explicit user allowlisting. The
   harness instructions prioritise the task's declared verification commands.

4. **Redaction (57, 58, 75, 76).** Best-effort only, documented as **not a
   security boundary**. A built-in secret pattern set, extensible via config,
   replaces matches with `[redacted]` before storing harness files, prompts,
   briefs, logs, and captured output. Path redaction is opt-in via config and
   reflected in `get_effective_config` (`path_redaction`, `redactions`).

5. **Limits + priority (7, 8).** Enforce global, provider, repo, group, and
   task limits from config; reuse the existing `budget_exhaustion_policy`
   (`stop_starting` / `cancel_running`). Replace the FIFO queue with a
   priority-ordered queue: higher `priority` runs first, inherited
   session → group → task, FIFO as the tie-breaker.

6. **Duplicate warnings (9).** Detect deterministically identical tasks within a
   single group submission and record a warning event; do not block (intentional
   competition stays possible).

7. **Events/artifacts (38, 46).** Record an event when
   `ignore_revision_conflict` overrides a stale-brief submission. Record merge
   conflicts as both an event and a `diff` artifact (the conflict patch),
   persisted in the store rather than only returned to the caller.

8. **Per-attempt recording (16, 17, 18, 19).** Populate the existing
   `requested_*` / `effective_*` attempt fields (model, reasoning, permissions,
   sandbox) and validate task requests against profile allowlists; record
   network/package-install policy per attempt.

9. **Export bundles (60, 61).** Export-only, never import. A plain directory of
   JSON plus an optional Markdown summary, with configurable log/artifact
   inclusion. Add a Cursor `mcpServers` setup snippet to the docs (73).

10. **Metrics (67).** Local-only, no telemetry. Store queue-wait, task duration,
    adapter failures, retries, verification outcome, and reported usage in a
    SQLite table, readable via both the CLI and MCP.

11. **Migrations (66).** Track schema version (`PRAGMA user_version`); on
    upgrade, snapshot/back up the database file before applying forward
    migrations. No automatic destructive downgrade.

12. **Preflight.** Refuse a dirty source repo by default before starting a task
    group.

## Rationale

The orchestrator-facing contract leaks local paths and offers no restart
guarantee, no resource ceilings, and no audit trail for overrides/conflicts —
the highest-value, lowest-risk fixes, so they lead. Skills are the deepest
change and gate real-world Codex usefulness, so they anchor the end of the
sequence once the surrounding machinery is stable. Reusing already-present
schema fields (`priority`, `requested_*`/`effective_*`, `budget_exhaustion_policy`)
keeps the diffs surgical. Redaction is explicitly framed as best-effort to avoid
implying a guarantee the PRD disclaims.

## Consequences

- The Scheduler's queue changes from FIFO to priority-ordered with FIFO
  tie-break; `CONTEXT.md` is updated accordingly.
- Boot is no longer side-effect-free: it mutates `running`/`queued` rows. Tests
  must cover restart recovery.
- `get_task_result` callers that relied on raw paths over MCP must use the CLI
  instead.
- Each closed gap requires new or updated tests, per the PRD testing decisions
  (restart recovery, queue limits, priority inheritance, duplicate warnings,
  override/conflict events, redaction markers, migrations, metrics, export).
- Profiles graduate from opaque `"default"` strings to real configuration that
  carries allowlists, limits, and policy.
