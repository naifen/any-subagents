# Schema Design

This document records the public schema shape for v1 before the Zod schemas are
implemented. Zod is the source of truth in code, and generated JSON Schemas are
published with the package.

All public objects include `schema_version`. Public timestamps are ISO 8601 UTC
strings.

Unknown top-level fields are rejected unless this document names an explicit
`metadata` extension object.

## IDs

Public IDs use prefixed NanoIDs:

- Session: `sess_...`
- Task group: `grp_...`
- Task: `task_...`
- Task attempt: `att_...`
- Artifact: `art_...`
- Event: `evt_...`

SQLite may use internal integer primary keys, but public APIs use prefixed IDs.

## Reasoning Level

Provider-neutral reasoning level values:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

Adapters may expose validated `reasoning_options` for provider-specific
controls.

## Session

Required fields:

- `schema_version`
- `session_id`
- `repo`
- `base_ref`
- `status`
- `brief`
- `created_at`
- `updated_at`

Optional fields:

- `budgets`
- `priority`
- `metadata`

Sessions close explicitly.

## Session Brief

The session brief is compact orchestrator-maintained shared state.

Recommended fields:

- `goal`
- `constraints`
- `decisions`
- `accepted_findings`
- `rejected_paths`
- `open_questions`

Subagents may propose updates, but only the orchestrator mutates the stored
brief.

## Task Group

Required fields:

- `schema_version`
- `group_id`
- `session_id`
- `title`
- `status`
- `tasks`
- `expected_brief_revision`
- `created_at`
- `updated_at`

Optional fields:

- `phase`
- `budgets`
- `budget_exhaustion_policy`
- `priority`
- `metadata`

Tasks inside a group are independent. Dependencies are represented by later task
groups.

Submission fails when `expected_brief_revision` is stale unless
`ignore_revision_conflict: true` is set. Ignoring a revision conflict records a
warning/event.

## Task Envelope

Required fields:

- `schema_version`
- `task_id`
- `session_id`
- `group_id`
- `mode`
- `goal`
- `adapter`
- `profile`
- `success_criteria`

Conditional fields:

- `scope` is required for `write` tasks.
- `verification_commands` are required only when the orchestrator needs runtime
  verification.

Optional fields:

- `base_ref`
- `model`
- `reasoning_level`
- `reasoning_options`
- `allow_fallback`
- `permissions`
- `sandbox`
- `constraints`
- `expected_output`
- `budgets`
- `timeout`
- `priority`
- `metadata`

Unknown top-level fields are rejected. Extensions go under `metadata`.

## Task Mode

Allowed values:

- `research`
- `plan`
- `diagnose`
- `write`
- `review`
- `verify`

## Task Attempt

Required fields:

- `schema_version`
- `attempt_id`
- `attempt_number`
- `task_id`
- `status`
- `created_at`
- `updated_at`

Recommended fields:

- `worktree_ref`
- `started_at`
- `finished_at`
- `requested_model`
- `effective_model`
- `requested_reasoning_level`
- `effective_reasoning_level`
- `requested_reasoning_options`
- `effective_reasoning_options`
- `requested_permissions`
- `effective_permissions`
- `requested_sandbox`
- `effective_sandbox`
- `usage`
- `metadata`

Attempts own process metadata, logs, result files, diffs, verification output,
and evidence.

## Result Envelope

Subagents write `.any-subagents/result.tmp.json` and atomically rename it to
`.any-subagents/result.json`.

Required fields:

- `schema_version`
- `task_id`
- `attempt_id`
- `status`
- `summary`
- `verification`
- `artifacts`
- `risks`
- `proposed_brief_updates`

The result must include at least one of:

- `findings`
- `changes`

Optional fields:

- `changed_files`
- `follow_up_tasks`
- `notes`
- `confidence`
- `usage`
- `metadata`

Allowed subagent result status values:

- `completed`
- `blocked`
- `failed`

The runtime owns operational statuses such as `queued`, `running`, `timed_out`,
`cancelled`, `interrupted`, `failed_contract`, and
`completed_with_failed_verification`.

## Artifact

Required fields:

- `schema_version`
- `artifact_id`
- `scope`
- `type`
- `mime_type`
- `summary`
- `created_at`

Scope can reference:

- `session_id`
- `group_id`
- `task_id`
- `attempt_id`

Recommended fields:

- `resource_uri`
- `size_bytes`
- `hash`
- `preview`
- `metadata`

MCP responses expose artifact IDs and resource URIs by default. CLI/admin
commands may expose local paths.

## Event

Required fields:

- `schema_version`
- `event_id`
- `type`
- `created_at`

Optional scope refs:

- `session_id`
- `group_id`
- `task_id`
- `attempt_id`
- `artifact_id`

Recommended fields:

- `severity`
- `message`
- `data`
- `metadata`

Events are append-only.

## Effective Config View

Effective config views include merged config layers, redacted secrets, resolved
storage paths, resolved `skill_paths`, profile defaults, adapter capabilities,
and security preset expansion.

Sensitive paths may be redacted for display.
