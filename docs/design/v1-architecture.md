# any-subagents v1 Architecture

Status: living draft. This document records locked design decisions for the
first usable version of `any-subagents`.

## Goal

`any-subagents` lets one LLM agent orchestrate many real LLM agent runtimes as
subagents for large, complex work. The v1 target is a provider-neutral local
control plane that exposes an MCP server for orchestrator agents and a CLI for
humans, tests, and debugging.

The first supported orchestrator host to document is Cursor. Antigravity and
other hosts should be added as their MCP/config surfaces are verified. The
first supported subagent adapter is Codex.

## Non-Goals

v1 explicitly does not:

- Plan or decompose work inside the runtime.
- Allow recursive subagent delegation.
- Auto-merge task outputs.
- Auto-resolve merge conflicts with another agent by default.
- Store provider/model API secrets.
- Expose a public cloud service.
- Support Cursor, Antigravity, or Grok as subagents yet.
- Implement a rich GUI or Manager view.
- Support mid-task subagent-to-orchestrator elicitation.
- Guarantee exact token/cost accounting for process-backed adapters.
- Summarize full transcripts with another LLM automatically.
- Schedule work across remote machines or clusters.
- Integrate with GitHub issues or pull requests in core.

## Core Nouns

- Session: a long-lived teamwork container with a stable base ref, shared brief,
  task groups, budgets, events, logs, artifacts, and merge attempts.
- Task group: a semantic phase and scheduling batch inside a session, such as
  research, implementation, or verification.
- Task: one delegated unit of work executed by one subagent process in an
  isolated worktree. A logical task may have multiple attempts.
- Task attempt: one concrete process execution for a task. Attempts own process
  metadata, logs, worktree, result files, diffs, and evidence. Attempts use
  public prefixed IDs such as `att_...`, with attempt numbers available for
  display.
- Artifact: a typed record for text, code, diff, log, evidence, benchmark,
  coverage, screenshot, recording, or arbitrary file output. Artifacts have an
  explicit scope and can attach to attempts, tasks, task groups, or sessions.

Sessions close explicitly. Task group status is derived from child task states
by default, with explicit cancellation/closure states.

Multiple clients may read the same session concurrently. Mutations use an
implicit one-writer-per-session rule through short transactions and conflict
errors when another writer is active.

## Product Shape

The core runtime is provider-neutral. Host-specific integrations are thin
surfaces over the same local daemon.

The orchestrator owns decomposition. It submits task groups and later decides
whether to submit more task groups, update the session brief, cancel work, or
merge selected winners. The runtime owns scheduling, durable state, worktree
isolation, process supervision, validation, logging, artifacts, metrics, and
queryable aggregation.

Subagents are real agent runtimes, not generic LLM API workers. v1 launches
Codex as an external process in a task worktree. The target launch mode is
non-interactive prompt execution; PTY control is only a fallback if needed.
Private/internal agent APIs are out of scope.

## APIs

The primary agent-facing API is an MCP server backed by the local daemon. The
CLI is the human/admin/debug API and should exercise the same daemon paths as
MCP tools.

v1 MCP tools:

- `create_session`
- `submit_task_group`
- `query_tasks`
- `get_task_result`
- `get_task_logs`
- `list_artifacts`
- `get_artifact`
- `update_session_brief`
- `get_session_digest`
- `cancel_tasks`
- `merge_tasks`
- `list_adapters`

MCP tools should have clear names, titles, descriptions, input schemas, and
structured output schemas where practical.

v1 also exposes a minimal read-only MCP resource surface for:

- public JSON Schemas
- session/task/artifact views
- session digests
- effective config summaries
- local docs that help orchestrators use the tool

MCP resources use stable custom URIs such as
`any-subagents://sessions/sess_x/artifacts/art_y`. MCP responses hide raw local
file paths by default and return artifact IDs/resource URIs instead. Local paths
are available only through explicit debug/admin fields or CLI commands.

Actions remain MCP tools. MCP prompts are deferred until repeated orchestration
patterns are proven.

The CLI command is `any-subagents`. It mirrors MCP operations with subcommands
and adds daemon/admin commands. It must support `help`, `help <subcommand>`,
`--help`, `-h`, `--version`, stable exit codes, human-readable output by
default, and `--json` for machine-readable read/query commands. Machine-readable
output goes to stdout; logs and errors go to stderr.

The CLI includes `any-subagents doctor` for local setup diagnostics. `doctor`
checks config, storage paths, daemon connectivity, MCP setup hints, adapter
health, worktree root, git availability, SQLite migration state, and effective
security/profile settings. It is human-readable by default and supports
`--json`. It performs only local/lightweight checks and never runs a real model
call. Real adapter smoke tests stay separate and explicit.

The CLI also exposes read-only effective config inspection, including merged
defaults, user config, project config, operational env overrides, and invocation
overrides where applicable. Effective config output redacts secrets and supports
JSON output for tests and automation.

Unlike MCP responses, the CLI is a local/admin surface and shows local paths by
default. CLI commands should support path redaction when requested or configured.

v1 supports exporting session data but not importing it. Export commands produce
a configurable bundle with session metadata, task groups, task results, events,
metrics, and artifact indexes by default. Logs and artifact contents are
optional and subject to redaction and size limits. Exports can include both a
machine-readable JSON bundle and an optional human-readable Markdown summary.

The daemon exposes a private local API to MCP and CLI clients. Unix domain
sockets are the default on macOS/Linux, with optional loopback TCP protected by
an auth token.

## Implementation Stack

v1 is a single TypeScript/Node package, with internal folder boundaries that can
later become packages:

- `src/core`
- `src/daemon`
- `src/mcp`
- `src/cli`
- `src/adapters`
- `src/db`
- `src/schemas`
- `src/test-support`

The package manager is `pnpm`, pinned through the `packageManager` field in
`package.json`.

Build and execution tooling:

- `tsx` for development execution.
- `tsup` for distributable CLI/MCP entrypoint bundles.
- `tsc --noEmit` for typechecking.
- Vitest for unit tests and fake-adapter integration tests.

Core libraries:

- MCP TypeScript SDK for the MCP server.
- Zod as the source of truth for runtime validation and generated public JSON
  Schemas.
- Commander.js for the CLI.
- Fastify for the private daemon API.
- Pino for structured daemon logging.
- `better-sqlite3` for SQLite access.
- Prefixed NanoID public IDs, with optional internal SQLite integer keys.

Public timestamps use ISO 8601 UTC strings, such as
`2026-06-17T12:34:56.789Z`. Internal epoch milliseconds may also be stored for
indexing and ordering.

## Runtime Lifecycle

1. The orchestrator creates a session for a repo and base ref.
2. The runtime performs practical preflight checks:
   - valid git repo
   - clean source repo by default
   - base ref exists
   - worktree root writable
   - adapter command available
   - config valid
   - daemon capacity and budgets available
   - result and artifact directories writable
3. The orchestrator submits a task group.
4. The runtime validates task envelopes and enqueues accepted tasks durably.
5. The scheduler starts tasks according to priority, fairness, and limits.
6. Each task gets an isolated git worktree under the configured worktree root.
7. The runtime writes harness files under `.any-subagents/` in the task
   worktree, excluded from merge/user diffs by default.
8. The Codex adapter launches the configured Codex command with a standard
   harness prompt and adapter-specific appendix.
9. The subagent writes `.any-subagents/result.json` and lists artifacts there.
10. The runtime validates `result.json`, captures logs, computes diffs, and
    registers artifacts.
11. The runtime independently runs declared final verification commands when
    configured.
12. The orchestrator queries compact status/digests/results and decides the
    next action.

## Task Envelopes

Task envelopes are typed, schema-versioned contracts. They include at least:

- `schema_version`
- goal/prompt
- task mode
- repo/session/group identity
- base ref or inherited session base
- adapter/profile request
- optional model and reasoning-level request, when supported by the adapter
- optional permissions and sandbox requests, when permitted by the selected
  profile
- scope, when required
- constraints
- success criteria
- verification commands
- expected output contract
- timeout and budget hints

Task group submission requires the expected session/brief revision by default so
the orchestrator does not launch work based on stale shared context. A caller may
explicitly set `ignore_revision_conflict: true` to submit anyway; the runtime
records a warning/event.

Task modes are a finite v1 enum:

- `research`
- `plan`
- `diagnose`
- `write`
- `review`
- `verify`

Write tasks require explicit scope. Research/read-only tasks may be broader.
Each task may request its own adapter/profile; the runtime enforces configured
allowlists and defaults.

Tasks may also request a specific LLM model and reasoning level when the
selected adapter supports those controls. Model and reasoning-level requests are
validated against adapter/profile allowlists. Unsupported reasoning-level
requests fail validation unless the task explicitly allows fallback behavior.
The provider-neutral `reasoning_level` enum is:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

Adapters may also expose validated adapter-specific `reasoning_options` for
provider-specific controls that do not fit the neutral enum.

Profiles define adapter defaults such as model, reasoning level, command
template, sandbox settings, and budget defaults. Tasks may override `model` and
`reasoning_level` when the selected profile permits those overrides. Unsupported
model or reasoning requests fail validation by default. If the task explicitly
sets `allow_fallback: true`, the runtime may use profile defaults or the nearest
configured supported value and must record a warning/event.

Each task attempt records requested and effective model, reasoning level, and
reasoning options so fallback behavior, cost, latency, and quality can be
audited later.

Tasks may request permissions and sandbox behavior such as network access,
browser access, shell access, file writes, package installs, and command policy.
Those requests are validated against selected profile allowlists. Task-level
permissions may narrow profile policy freely, but may broaden it only when the
profile explicitly permits that override.

## Result Contract

The primary subagent result contract is `.any-subagents/result.json`. A final
JSON block in stdout can be a fallback, but the runtime should not use another
LLM to silently repair or summarize malformed results in v1.

Required result fields:

- `schema_version`
- `task_id`
- `attempt_id`
- `status`
- `summary`
- `findings` or `changes`
- `verification`
- `artifacts`
- `risks`
- `proposed_brief_updates`

Optional result fields:

- `changed_files`
- `follow_up_tasks`
- `notes`
- `confidence`
- `usage`

Subagent result status is limited to:

- `completed`
- `blocked`
- `failed`

The runtime owns operational states such as `queued`, `running`, `timed_out`,
`cancelled`, `interrupted`, `failed_contract`, and
`completed_with_failed_verification`.
In v1, `blocked` is terminal. Subagents include blocking questions or missing
inputs in the result envelope, and the orchestrator decides whether to answer by
submitting follow-up work.

Invalid task envelopes are rejected before enqueue. Invalid result files mark the
task as `failed_contract` and preserve raw output, logs, diffs, and artifacts.

## Session Brief

A session preserves runtime metadata plus a compact shared brief containing
goals, constraints, decisions so far, accepted findings, rejected paths, and
open questions.

Only the orchestrator updates the session brief. Subagents may propose brief
updates in `result.json`, but those updates are untrusted until explicitly
accepted or edited by the orchestrator.

Session brief updates use optimistic concurrency. Update calls must include the
expected brief revision/version so stale writers cannot silently overwrite newer
decisions or accepted findings.

## Scheduling, Budgets, and Scale

The orchestrator decides desired fan-out by submitting task groups. The runtime
decides executable fan-out by enforcing:

- global max concurrency
- per-provider max concurrency
- per-repo max concurrency
- per-task timeouts
- cost/token budgets where available
- machine resource limits
- priority/fairness scheduling

Excess accepted work is queued durably, with admission limits. Normal v1 design
target is 10-20 queued/running tasks. Stress tests should cover 100 queued tasks
with a fake adapter. Real Codex concurrency is configurable and constrained by
the local machine and provider behavior.

Token/cost tracking is best effort for process-backed adapters. Wall-clock and
concurrency limits are enforced exactly. Usage fields must distinguish reported
from estimated values.

Tasks inside a task group are independent. Dependencies are represented by later
task groups/phases submitted by the orchestrator after it inspects earlier
results.

Session, task group, and task levels can each define budgets and limits. Priority
inherits downward from session to task group to task unless overridden.

If a group budget is exhausted, the default policy is `stop_starting`: no more
queued tasks from that group are started, but already running tasks are allowed
to finish. A group may explicitly choose `cancel_running` for hard ceilings.

The runtime warns on likely duplicate tasks within a group but still allows
them. Duplicate warnings use a deterministic fingerprint from normalized mode,
goal, scope, and adapter/profile.

## Task Attempts and Restart Semantics

The data model distinguishes logical tasks from task attempts. A task has one or
more attempts. Each attempt owns its process metadata, worktree, logs, result
files, diffs, verification output, and evidence artifacts.

Task APIs show the latest attempt by default and include `attempt_count` and
`latest_attempt_id`. Detailed result/log/artifact calls can request a specific
`attempt_id`.

Automatic retries are limited to infrastructure failures such as agent process
crashes, CLI launch failures, transient rate limits, or missing heartbeat.
Semantic/task failures are not retried automatically.

Each automatic retry uses a fresh worktree and a new attempt. Failed-attempt
evidence remains linked to the logical task.

After a daemon restart, queued tasks resume from durable state. Tasks that were
running when supervision was lost are marked `interrupted`. Interrupted tasks
are not automatically retried; the orchestrator inspects available evidence and
decides whether to retry, salvage, or discard.

## Worktrees and Merging

Each task runs in its own git worktree. Worktree names use a hybrid short ID plus
human-readable slug and follow the project rule:

```text
/Users/jg/Repos/worktrees/<project>-<branch-or-task>
```

By default, task branches are based on the session base ref. The orchestrator may
explicitly override the base ref when needed.

The runtime does not auto-merge task results. `merge_tasks` creates an
integration worktree for selected winners, attempts deterministic sequential
merge/cherry-pick, reports conflicts, and leaves the integration worktree for
orchestrator or human resolution.

## Verification

Subagents may run tests or verification during their work. The runtime can also
run declared final verification commands after the subagent exits and attach
outputs as artifacts.

If the subagent reports success but runtime verification fails, the task status
is `completed_with_failed_verification`.

## Artifacts and Logs

Artifacts are stored in an arbitrary artifact registry with strong v1 metadata
support for text, code, diffs, logs, and evidence. Artifact records include
fields such as id, task id, type, MIME type, path or URI, summary, created time,
size, hash, preview, and metadata.

Subagents list artifacts in `result.json`. The runtime may perform light
discovery as a safety net, but should not infer semantic meaning from arbitrary
files.

Write tasks produce a patch artifact plus changed file list and stats.

Full raw stdout/stderr/transcript logs are stored on disk and indexed by task.
MCP/CLI returns previews and refs by default, not huge log bodies. Capture limits
and retention are configurable. Truncation must be explicit.
MCP artifact responses expose artifact IDs and resource URIs by default rather
than raw local filesystem paths.

## Safety

Permission enforcement is layered:

- The runtime enforces outer bounds: worktree isolation, env allowlists, adapter
  allowlists, no stored provider secrets, budgets, path limits, retention, and
  destructive-action confirmation.
- The subagent runtime enforces its own sandbox/approval rules.

Provider secrets are never stored in v1. The runtime relies on already
authenticated local agent CLIs/apps and passes only an explicit environment
allowlist to child processes.

The runtime applies best-effort redaction before writing harness files, prompts,
briefs, logs, and captured output where practical. Redaction uses explicit
env-allowlist values and configured secret patterns. Fixed markers such as
`[REDACTED:API_KEY]` are the default. Optional keyed hashes/fingerprints may be
enabled explicitly when users need to correlate repeated appearances of the same
secret without storing the secret itself.

Redaction is not a security boundary and must be documented as imperfect.

Task modes map to default permissions:

- `research`: read repo, no writes expected; any diff is a policy violation.
- `plan`: read repo, may write only declared plan/artifact files if explicitly
  allowed; no source changes.
- `diagnose`: read repo, may run commands/tests, may write temporary
  instrumentation only if scoped; source diffs flagged unless allowed.
- `write`: may edit scoped files and run verification.
- `review`: read repo/diff, no writes expected.
- `verify`: run declared commands/tests, no source writes expected.

Read-only modes should be physically read-only where practical, use adapter
sandbox flags where available, and always post-check diffs.

Network access follows adapter/profile defaults in v1. Package install
permission also follows adapter/profile defaults, with task overrides only when
the profile permits them. Requested and effective network/package-install
policies are recorded on each attempt.

Profiles may define command allowlists and denylists. Task-level command policy
can narrow the selected profile policy, but cannot broaden dangerous or
destructive command access unless the profile explicitly permits it. Enforcement
uses adapter sandbox flags or wrappers where practical and post-run detection
where direct enforcement is not available.

Detected lockfile/package changes are recorded in task result metadata or
artifacts.

v1 provides minimal built-in security presets: `strict`, `default`, and
`permissive`. These are config shortcuts that expand into normal
permissions/sandbox/concurrency defaults. They are not a separate policy system.

All subagent outputs and artifacts are treated as untrusted evidence. Schema
validation checks shape, not truth or safety. The runtime never auto-applies
brief updates or executes commands suggested by subagent output without explicit
orchestrator action.

## Persistence and Storage

v1 uses SQLite plus filesystem artifact/log storage. The SQLite access layer is
direct `better-sqlite3` with handwritten SQL migrations and small repository
modules.

Migrations are automatic forward migrations on daemon startup, with a backup or
snapshot before migration. Automatic destructive downgrades are unsupported in
v1.

Storage locations follow OS-native app directory conventions. See
`docs/design/storage-layout.md`.

Task prompts, session briefs, logs, and artifacts are stored in plaintext local
storage by default. Docs and CLI commands must make storage locations and prune
controls clear. Best-effort redaction runs before storage where practical, but
encryption is not part of v1 and can be added later.

Session export is supported for debugging, handoff, and bug reports. Session
import is deferred because restoring paths, worktrees, artifacts, and trust
boundaries safely needs a separate design.

## Events, Observability, and Metrics

The runtime stores append-only events for state changes, lifecycle milestones,
retries, cancellation, artifact registration, merge attempts, validation
failures, and verification outcomes.

Events are stored in one append-only table with nullable scope refs for session,
task group, task, attempt, and artifact. This supports both chronological
session timelines and entity-specific filtering.

v1 uses polling via MCP/CLI. The event model should support SSE/WebSocket/MCP
progress streaming later.

While tasks are running, v1 exposes state, tail-able logs, and compact heartbeat
summaries. Full transcript streaming is not the default.

Daemon logs default to `info`, support `debug` and `trace`, redact known
secrets best-effort, and rotate by size/age.

Local-only metrics are stored in SQLite/status APIs. There is no telemetry in
v1.

## Adapters

Codex is built in for v1 if that keeps the first release small. The internal
adapter boundary should be shaped so it can become an external adapter process
protocol later.

The Codex command and args are configurable with sensible defaults. Adapter
health checks are lightweight: command found, version if available, auth likely
available if detectable, capabilities, and configured concurrency. Health checks
must not perform model calls by default.

Adapter capability metadata should include whether model selection and
reasoning-level selection are supported, the configured allowed values, and the
fallback behavior when a task requests an unsupported value.

The CLI should include an explicit opt-in real adapter smoke command for Codex.

Adapters should expose skill-related capability metadata such as
`supports_native_skills`, `supports_skill_paths`, and `skill_path_strategy`.
The harness should preserve the subagent runtime's native global/user-level skill
discovery by default. It should also support configured local `skill_paths` when
repo-local or machine-local skills would not otherwise be visible inside a task
worktree.

## Installation and Host Setup

v1 distribution is an npm package, with source checkout support for
development. MCP host setup should provide manual config snippets by default and
an optional installer command for known hosts. Installer commands must support
confirmation and dry-run behavior.

The daemon can be started explicitly and may be auto-started by clients when
configured. Auto-start should be visible, not silent magic.

## Configuration

Config files use TOML. Configuration is layered in this order:

```text
built-in defaults < user config < project config < environment variables < CLI flags/task envelope
```

Environment variables are for operational/bootstrap overrides only, such as
socket path, config path, log level, daemon URL/token, and test mode. They should
not mirror every nested config key.

Unknown config keys fail validation with a clear path to the invalid key.
Unknown top-level task and result envelope fields are rejected. Extensions are
allowed only under explicit `metadata` objects.

The user/project config controls defaults such as:

- worktree root
- daemon socket/TCP settings
- concurrency limits
- retention policy
- adapter commands and profiles
- environment allowlists
- default budgets and timeouts

Effective config views include resolved storage paths and resolved `skill_paths`
by default. Config can mark sensitive paths for display redaction when needed.

## Harness Files

Each task worktree contains a local `.any-subagents/` harness directory. v1
creates these files:

- `task.json`: full task envelope.
- `brief.md`: current orchestrator-maintained session brief snapshot.
- `instructions.md`: standard harness prompt and adapter appendix.
- `result.schema.json`: generated public result schema for this schema version.
- `result.tmp.json`: preferred in-progress result output path.
- `result.json`: final result file path.
- `artifacts/`: optional staging directory for task artifacts.

Subagents should write `result.tmp.json` and then atomically rename it to
`result.json`. The runtime tolerates direct or partial writes but warns and
preserves malformed evidence.

The task worktree should add `.any-subagents/` to `.git/info/exclude`, not the
repo's `.gitignore`. Diff computation also filters `.any-subagents/`
defensively.

## Skill Access

Subagents must be able to use global/user-level skills and repo-local skills
available to their native runtime.

v1 uses a hybrid strategy:

- Preserve the subagent runtime's native global/user-level skill discovery.
- Ensure repo-local skill directories that are part of the source repo are
  visible in task worktrees.
- Support configured `skill_paths` for local skills that live outside the task
  worktree.
- Make configured skill paths read-only for subagents where practical.
- Mount configured skill paths per path. The default mount strategy is symlink
  for trusted local paths. Copy is available when snapshot isolation is
  requested.
- Allow `skill_paths` in both user and project config. Project config paths must
  be repo-relative unless an external/absolute path is explicitly allowlisted by
  user config.
- Treat mounted skills as read-only by default. Subagent modification of mounted
  skills is a policy violation.
- Record effective skill paths in task harness metadata.
- Do not parse, rewrite, or summarize skill contents in the runtime.
- Do not inject full skill contents into prompts by default.

The runtime is responsible for making skill availability explicit and observable,
not for becoming a skill interpreter.

## Testing

The primary test harness uses a fake adapter process. It should prove daemon,
MCP/CLI clients, queueing, worktree setup, result file parsing, logs, artifacts,
cancellation, verification, and fake-adapter stress behavior without invoking
real Codex.

Real-Codex smoke tests are optional and explicit because they depend on local
auth, model behavior, time, and cost.

## References

- MCP specification and TypeScript SDK:
  https://github.com/modelcontextprotocol/modelcontextprotocol
  https://github.com/modelcontextprotocol/typescript-sdk
- CLI Guidelines:
  https://clig.dev/
- GNU command-line interface standards:
  https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html
- Storage layout decision:
  `docs/design/storage-layout.md`
- Domain glossary:
  `CONTEXT.md`
- Orchestrator usage runbook:
  `docs/usage/orchestrator-runbook.md`
- Subagent harness template:
  `docs/design/subagent-harness.md`
- Public schema design:
  `docs/design/schemas.md`
- Phased implementation plan:
  `docs/design/implementation-plan.md`

## Deferred

- Runtime-mediated mid-task elicitation, such as an `input_required` state where
  a running subagent can ask the orchestrator or user for more information and
  then continue.
- MCP prompts for common orchestration patterns such as planning task groups,
  synthesizing results, or reviewing failed tasks.
- Session import from exported bundles.
