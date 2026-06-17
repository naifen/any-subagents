# Implementation Plan

This plan converts the v1 architecture into phased vertical slices. Each phase
should keep the product runnable and verifiable before the next phase starts.

## Phase 1: Fake Adapter End-to-End

Goal: prove the local control plane without real model/auth variability.

Build:

- Single TypeScript package scaffold with `pnpm`, `tsx`, `tsup`, `tsc --noEmit`,
  Vitest, Commander, Fastify, Pino, Zod, `better-sqlite3`, and NanoID.
- Public Zod schemas and generated JSON Schema files for sessions, task groups,
  tasks, attempts, results, artifacts, events, and effective config.
- SQLite migrations and repository modules.
- OS-native storage path resolution.
- Local daemon with private API over Unix socket or test transport.
- CLI commands for daemon start/status, session create, task-group submit, task
  query, task result, logs, artifacts, and cancel.
- Fake adapter process that reads harness files, writes `result.tmp.json`, then
  renames to `result.json`.
- Worktree creation, `.any-subagents/` harness files, `.git/info/exclude`, log
  capture, result validation, artifact registration, and patch artifact
  creation.
- Task/attempt distinction, infrastructure retry attempts, interrupted restart
  handling, and append-only events.

Verify:

- Unit tests for schema validation and config validation.
- Migration tests using temp SQLite DBs.
- Integration test creates a temp git repo, starts daemon, submits a task group
  with fake tasks, waits for completion, reads results, logs, artifacts, and
  session digest.
- Integration test covers malformed `result.json` -> `failed_contract`.
- Integration test covers cancellation and timeout.
- Stress test queues 100 fake tasks with bounded concurrency.

## Phase 2: MCP Tools and Resources

Goal: expose the same control-plane paths to orchestrator agents.

Build:

- MCP server using the MCP TypeScript SDK.
- Tools: `create_session`, `submit_task_group`, `query_tasks`,
  `get_task_result`, `get_task_logs`, `list_artifacts`, `get_artifact`,
  `update_session_brief`, `get_session_digest`, `cancel_tasks`, `merge_tasks`,
  and `list_adapters`.
- Read-only MCP resources for schemas, session/task/artifact views, session
  digests, effective config summaries, and local usage docs.
- Stable `any-subagents://...` resource URIs.
- MCP path-hiding behavior: artifact IDs/resource URIs by default, no raw local
  paths unless explicitly requested through debug/admin surfaces.

Verify:

- MCP integration tests call each tool against the daemon using fake adapter
  sessions.
- MCP resource tests read schema and artifact resources by custom URI.
- Contract tests assert tool input/output schemas match generated JSON Schemas
  where applicable.
- Tests assert MCP responses hide raw filesystem paths by default.

## Phase 3: Codex Adapter Smoke Path

Goal: validate one real process-backed subagent adapter.

Build:

- Built-in Codex adapter with configurable command and args template.
- Adapter profiles with model, reasoning level, reasoning options, permissions,
  sandbox, command policy, budgets, and concurrency defaults/allowlists.
- Requested/effective model, reasoning, permissions, and sandbox recording per
  attempt.
- Lightweight Codex adapter health checks.
- Explicit `any-subagents adapter smoke codex` command.
- Graceful stop then hard-kill behavior.
- Best-effort redaction before harness/log storage.

Verify:

- Fake Codex-command tests validate command templating and result-file parsing.
- Health check tests cover command missing, version available, and unsupported
  model/reasoning requests.
- Optional real-Codex smoke test runs a tiny temp-repo task and validates
  `result.json`.
- Cancellation test confirms partial evidence is preserved when possible.

## Phase 4: Merge and Integration Worktrees

Goal: make selected subagent winners useful for coding workflows.

Build:

- `merge_tasks` implementation that creates an integration worktree.
- Deterministic sequential merge/cherry-pick of selected task attempts.
- Conflict detection and reporting.
- Integration artifacts: merge report, conflict summary, changed file list, and
  patch stats.
- Explicit no-auto-merge behavior preserved.

Verify:

- Integration tests merge non-conflicting fake task branches.
- Integration tests report conflicts and leave the integration worktree for
  inspection.
- Tests ensure `.any-subagents/` harness files are excluded from merge/user
  diffs.
- Tests cover selected attempt IDs, not just latest task attempts.

## Phase 5: Doctor and Effective Config

Goal: make setup and debugging practical across local daemon, MCP host, adapter,
storage, profiles, and skill paths.

Build:

- `any-subagents doctor` with human output and `--json`.
- Effective config inspection with merged config layers, storage paths,
  profiles, security preset expansion, adapter capabilities, resolved
  `skill_paths`, and redacted secrets.
- Sensitive path display redaction.
- Skill path validation and mount planning diagnostics.
- MCP setup snippet generation and optional dry-run installer scaffolding for
  Cursor.

Verify:

- Doctor tests cover missing git, missing adapter command, invalid config,
  unwritable storage, daemon unavailable, and healthy setup.
- Effective config tests cover precedence:
  built-in defaults < user config < project config < env vars < CLI/task.
- Redaction tests cover secret values, configured patterns, and optional path
  redaction.
- Skill path tests cover repo-relative paths, user-allowlisted absolute paths,
  symlink default, copy strategy, and read-only policy reporting.

## Deferred After These Slices

- Retention/prune/export polish beyond basics needed by tests.
- External adapter process protocol.
- Antigravity host setup.
- Cursor, Antigravity, or Grok as subagents.
- MCP prompts.
- OpenAPI/private daemon API docs.
- Shell completions.
- Mid-task elicitation.
- Session import.
- Rich GUI/Manager view.
