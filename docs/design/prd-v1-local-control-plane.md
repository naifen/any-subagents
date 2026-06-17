# PRD: any-subagents v1 Local Control Plane

## Problem Statement

LLM agents are increasingly capable, but large software tasks still exceed what
one agent session can handle cleanly. A single orchestrator can decompose work,
but it has no reliable provider-neutral way to launch many real subagents,
isolate their work, supervise progress, compare outputs, preserve evidence, and
merge selected winners.

The user wants an easy-to-use, high-performance, token-efficient tool that lets
an orchestrator such as Cursor use many Codex subagents in parallel for complex
work. The normal target is 10-20 subagents, with an architecture that can stress
test 100 queued fake-adapter tasks without a rewrite. The tool must preserve
subagent-native capabilities, including global and local skills, while giving
the orchestrator compact structured results instead of full transcript noise.

## Solution

Build `any-subagents` v1 as a provider-neutral local control plane. The control
plane runs as a local daemon that owns durable session state, task group queues,
task attempts, worktree isolation, process supervision, result validation,
artifacts, logs, events, metrics, and merge attempts.

The primary agent-facing surface is MCP. The human/admin/debug surface is a CLI.
Both surfaces talk to the same daemon so there is one owner for scheduling,
processes, and state.

v1 supports Codex as the first built-in subagent adapter. The first documented
orchestrator host is Cursor. Antigravity and other hosts are designed for later,
once their MCP/config surfaces are verified. The runtime does not plan work:
the orchestrator creates sessions, submits task groups, updates the session
brief, chooses winners, and decides follow-up actions.

## User Stories

1. As an orchestrator, I want to create a session for a repository and base ref, so that delegated work has a stable shared context.
2. As an orchestrator, I want a compact session brief, so that later task groups can share decisions without replaying every transcript.
3. As an orchestrator, I want to submit a task group as a semantic phase, so that research, implementation, review, and verification stay separated.
4. As an orchestrator, I want tasks inside a task group to run independently, so that parallelism stays simple and predictable.
5. As an orchestrator, I want to submit 10-20 subagent tasks normally, so that large work can be explored in parallel.
6. As an orchestrator, I want the control plane to durably queue excess tasks, so that I can express a full work plan without micromanaging slots.
7. As an orchestrator, I want global, provider, repo, group, and task limits enforced, so that a large task group cannot exhaust local resources.
8. As an orchestrator, I want priority to inherit from session to task group to task, so that I can prioritize a phase without repeating fields.
9. As an orchestrator, I want deterministic duplicate warnings inside a task group, so that accidental duplicate tasks are visible but intentional competition remains possible.
10. As an orchestrator, I want task envelopes to include mode, goal, scope, constraints, success criteria, verification commands, budget, adapter, profile, model, and reasoning settings, so that subagents receive clear contracts.
11. As an orchestrator, I want write tasks to require scope, so that subagents do not trample unrelated files.
12. As an orchestrator, I want task modes for research, plan, diagnose, write, review, and verify, so that permissions and expectations can follow the work type.
13. As an orchestrator, I want to request a model and reasoning level per task when allowed, so that critical tasks can use stronger settings and routine tasks can use cheaper settings.
14. As an orchestrator, I want unsupported model or reasoning requests to fail by default, so that silent fallback does not waste budget or mislead me.
15. As an orchestrator, I want explicit fallback to be possible, so that low-risk exploratory work can proceed when an exact setting is unavailable.
16. As an orchestrator, I want requested and effective model/reasoning values recorded per attempt, so that I can audit cost, latency, and quality later.
17. As an orchestrator, I want task-level permissions and sandbox requests validated against profile allowlists, so that I can narrow or safely broaden tool access when needed.
18. As an orchestrator, I want network and package-install policy to be visible per attempt, so that I can understand what environment produced a result.
19. As an orchestrator, I want command allowlists and denylists in profiles, so that dangerous command access can be bounded.
20. As an orchestrator, I want a stable `Task` identity with multiple `TaskAttempt`s, so that infrastructure retries preserve one logical task while retaining evidence per run.
21. As an orchestrator, I want task APIs to show the latest attempt by default, so that normal status reads stay compact.
22. As an orchestrator, I want to request a specific attempt's logs or artifacts, so that retry history is debuggable.
23. As an orchestrator, I want infrastructure failures to retry in fresh worktrees, so that unknown partial state does not contaminate a new attempt.
24. As an orchestrator, I want semantic failures not to retry automatically, so that the root agent decides whether to rescope, retry, or discard.
25. As an orchestrator, I want running tasks to become interrupted after daemon restart, so that lost supervision is explicit and evidence is preserved.
26. As an orchestrator, I want blocked tasks to be terminal in v1, so that missing inputs are handled through follow-up work rather than fragile mid-task elicitation.
27. As an orchestrator, I want subagent results to include summary, findings or changes, verification, artifacts, risks, and proposed brief updates, so that aggregation is cheap and structured.
28. As an orchestrator, I want result files to require both task ID and attempt ID, so that stale or misplaced output is rejected.
29. As an orchestrator, I want malformed result files to produce failed-contract status, so that useful evidence is preserved without trusting bad structure.
30. As an orchestrator, I want a compact session digest, so that I can decide next actions without reading every task result.
31. As an orchestrator, I want artifact previews and resource URIs, so that I can inspect evidence on demand without loading huge logs.
32. As an orchestrator, I want raw local paths hidden in MCP responses by default, so that agent context does not leak local filesystem details.
33. As an orchestrator, I want CLI/admin commands to show local paths by default, so that local debugging remains practical.
34. As an orchestrator, I want all subagent outputs treated as untrusted evidence, so that prompt injection or bad claims are not automatically applied.
35. As an orchestrator, I want subagents to propose session brief updates separately, so that I can accept, edit, or reject them explicitly.
36. As an orchestrator, I want session brief updates to use optimistic concurrency, so that stale clients cannot overwrite newer decisions.
37. As an orchestrator, I want task group submission to require an expected brief revision, so that I do not launch work based on stale context.
38. As an orchestrator, I want an explicit ignore-revision-conflict override, so that I can proceed when a context change is known to be irrelevant.
39. As an orchestrator, I want to cancel tasks, task groups, or sessions idempotently, so that retries after disconnects are safe.
40. As an orchestrator, I want graceful stop before hard kill, so that partial findings can be captured when possible.
41. As an orchestrator, I want runtime verification commands to run after subagent exit when configured, so that final evidence does not rely only on subagent claims.
42. As an orchestrator, I want successful subagent work with failed runtime verification to be marked distinctly, so that I can inspect or fix it without losing the result.
43. As an orchestrator, I want patch artifacts and changed-file stats for write tasks, so that competing implementations are easy to compare.
44. As an orchestrator, I want to choose merge winners explicitly, so that the runtime never auto-merges questionable work.
45. As an orchestrator, I want selected winners merged into an integration worktree, so that conflicts and combined diffs are inspectable.
46. As an orchestrator, I want merge conflicts reported as artifacts/events, so that follow-up work can target the integration problem.
47. As an orchestrator, I want no recursive subagent delegation in v1, so that fan-out, costs, and accountability remain clear.
48. As a subagent, I want a strict harness with task envelope, brief, instructions, schema, result paths, and artifact staging, so that I know exactly what contract to satisfy.
49. As a subagent, I want access to global/user-level and repo-local skills through native discovery, so that I can use the skills available in normal operation.
50. As a subagent, I want configured external skill paths mounted read-only, so that local skills can be used without being mutated.
51. As a subagent, I want the harness to tell me not to spawn additional subagents, so that I do not violate v1 execution boundaries.
52. As a subagent, I want declared verification commands prioritized, so that I do not invent irrelevant checks.
53. As a human developer, I want a CLI that mirrors MCP operations, so that I can debug the same paths an orchestrator uses.
54. As a human developer, I want CLI help, subcommand help, version output, stable exit codes, and JSON output, so that the tool is scriptable and understandable.
55. As a human developer, I want a doctor command, so that setup problems across config, storage, daemon, MCP, adapters, worktrees, and profiles are diagnosable.
56. As a human developer, I want effective config inspection, so that I can see merged config, resolved paths, profile defaults, adapter capabilities, and security preset expansion.
57. As a human developer, I want secrets redacted in effective config and logs, so that local diagnostics are safer to share.
58. As a human developer, I want optional path redaction, so that sensitive local paths can be hidden when needed.
59. As a human developer, I want OS-native storage locations, so that state, logs, cache, config, and runtime sockets live where my platform expects.
60. As a human developer, I want export-only session bundles, so that I can hand off debugging information without restoring untrusted state.
61. As a human developer, I want exports to include JSON and optional Markdown summaries, so that both tools and people can consume them.
62. As a maintainer, I want public JSON Schemas generated from Zod, so that agents, tests, and adapters share one contract.
63. As a maintainer, I want strict top-level schema validation with metadata extension points, so that typos fail but controlled extensions remain possible.
64. As a maintainer, I want append-only events scoped to sessions, groups, tasks, attempts, and artifacts, so that timelines are auditable.
65. As a maintainer, I want SQLite-backed durable state, so that queues, events, metrics, artifacts, and retries survive process restarts.
66. As a maintainer, I want automatic forward migrations with backups, so that local upgrades are smooth and recoverable.
67. As a maintainer, I want local-only metrics without telemetry, so that performance can be tuned without privacy concerns.
68. As a maintainer, I want fake-adapter integration tests, so that the control plane can be verified deterministically without real model calls.
69. As a maintainer, I want optional real-Codex smoke tests, so that adapter behavior can be validated without making normal CI flaky or expensive.
70. As a maintainer, I want a single TypeScript package for v1, so that the daemon, MCP server, CLI, schemas, and adapter can evolve without early package overhead.
71. As an adapter author, I want adapter capability metadata, so that orchestrators know supported modes, model controls, reasoning controls, skills, permissions, and health.
72. As an adapter author, I want Codex built in first but boundaries shaped for external adapters later, so that v1 stays small while future providers remain possible.
73. As a Cursor user, I want manual MCP setup snippets and optional installer support, so that I can connect Cursor as the first documented orchestrator host.
74. As a security-conscious user, I want no provider secrets stored in the control plane, so that existing local agent authentication remains the credential boundary.
75. As a security-conscious user, I want best-effort redaction before storage, so that prompts, briefs, logs, and outputs are less likely to retain secrets.
76. As a security-conscious user, I want redaction documented as imperfect, so that I understand it is not a security boundary.
77. As a security-conscious user, I want strict, default, and permissive security presets, so that safety posture is easy to choose without learning every config field.
78. As a performance-focused user, I want bounded concurrency and durable queues, so that normal 10-20 subagent use is responsive and 100 fake queued tasks can be stress-tested.
79. As a performance-focused user, I want compact digests and previews, so that the orchestrator does not waste tokens on full transcripts.
80. As a future host integrator, I want stable MCP resource URIs, so that read-only schemas, session views, and artifacts are addressable without local paths.

## Implementation Decisions

- Build a provider-neutral local control plane as the core runtime.
- Keep host integrations thin; document Cursor first and add Antigravity later after verification.
- Use real process-backed subagents rather than generic LLM API workers.
- Ship Codex as the first built-in subagent adapter.
- Use one worktree per task attempt and keep task harness files out of user diffs.
- Use a session/task group/task/task attempt/artifact domain model.
- Keep the orchestrator responsible for decomposition, session brief updates, winner selection, and follow-up work.
- Keep the runtime responsible for scheduling, durable state, worktree isolation, process supervision, validation, logs, artifacts, events, metrics, and merge attempts.
- Use MCP as the primary agent-facing API and a CLI as the local/admin/debug API.
- Route MCP and CLI through one local daemon so process supervision has a single owner.
- Provide MCP tools for session creation, task group submission, task queries, result/log/artifact reads, brief updates, session digests, cancellation, merge attempts, and adapter listing.
- Provide minimal read-only MCP resources for schemas, session/task/artifact views, digests, effective config summaries, and local docs.
- Defer MCP prompts until repeated orchestration patterns are proven.
- Hide raw local filesystem paths in MCP responses by default.
- Show paths in CLI/admin output by default, with redaction options.
- Use stable custom MCP resource URIs for resources.
- Use a single TypeScript/Node package for v1 with internal package-like boundaries.
- Use pnpm, tsx, tsup, tsc typechecking, Vitest, Commander.js, Fastify, Pino, Zod, better-sqlite3, and NanoID.
- Use Zod as the schema source of truth and publish generated JSON Schemas.
- Use prefixed public IDs for sessions, task groups, tasks, task attempts, artifacts, and events.
- Use ISO 8601 UTC strings in public APIs and schemas.
- Use SQLite plus filesystem storage for durable state, logs, diffs, results, and arbitrary artifacts.
- Use OS-native app directories for state, config, logs, cache, and runtime sockets.
- Use automatic forward migrations with backup/snapshot before migration; no automatic destructive downgrade.
- Use TOML for user/project config.
- Use config precedence: built-in defaults, user config, project config, environment operational overrides, then CLI flags/task envelopes.
- Fail validation on unknown config keys.
- Reject unknown top-level task/result fields; allow controlled extensions under metadata.
- Include effective config inspection with resolved storage paths, resolved skill paths, profile defaults, adapter capabilities, and security preset expansion.
- Use a strict contract-first subagent harness.
- Require subagents to write a temporary result file and atomically rename it to the final result file.
- Require result envelopes to include both task ID and attempt ID.
- Limit subagent result statuses to completed, blocked, and failed.
- Keep operational statuses owned by the runtime, including queued, running, timed out, cancelled, interrupted, failed contract, and completed with failed verification.
- Treat blocked as terminal in v1.
- Use append-only events with nullable scope references.
- Record requested and effective model, reasoning, permissions, sandbox, network, and package-install policies per attempt.
- Define neutral reasoning levels: minimal, low, medium, high, xhigh, and max.
- Allow adapter-specific reasoning options through validated escape hatches.
- Validate model/reasoning requests against adapter/profile allowlists.
- Fail unsupported model/reasoning requests by default; allow explicit fallback with warning/event.
- Preserve native global/user-level skill discovery and repo-local skills.
- Support configured skill paths through read-only symlink/copy mounts, with user allowlisting for external project-config paths.
- Do not parse, rewrite, summarize, or inject full skill contents by default.
- Apply best-effort redaction before storing harness files, prompts, briefs, logs, and captured output where practical.
- Store provider secrets nowhere in v1; rely on existing local agent authentication and explicit env allowlists.
- Implement strict, default, and permissive security presets as config shortcuts, not a separate policy system.
- Use layered permission enforcement: runtime outer bounds plus subagent-native sandbox behavior.
- Let task-level permissions narrow profile policy freely and broaden only when the profile permits it.
- Use profile-level command allow/deny lists with task-level narrowing only.
- Use practical preflight checks before starting task groups.
- Refuse dirty source repos by default.
- Resume queued tasks after daemon restart; mark previously running tasks as interrupted.
- Retry infrastructure failures only, and use a fresh worktree per retry attempt.
- Keep task APIs focused on latest attempt by default, with attempt-specific detail access.
- Allow multiple readers per session and one implicit writer per session mutation.
- Require expected brief revision for brief updates and task group submission.
- Allow explicit revision-conflict override for task group submission, recorded as warning/event.
- Make cancellation idempotent and support task, task group, and session targets.
- Run runtime verification after subagent exit when configured.
- Mark successful subagent output with failed runtime verification distinctly.
- Store full logs on disk with preview/ref access and configurable capture/retention limits.
- Generate patch artifacts and changed-file stats for write tasks.
- Provide explicit merge of selected winners into an integration worktree; never auto-merge task outputs.
- Provide export-only session bundles with configurable logs/artifacts and JSON plus optional Markdown summary.
- Defer import, shell completions, OpenAPI/private API docs, mid-task elicitation, rich GUI, cloud service, remote scheduling, recursive delegation, runtime planning, and additional subagent adapters.

## Testing Decisions

- Test the highest behavior seam first: a daemon plus CLI plus fake adapter running against a temporary git repository.
- Prefer fake-adapter integration tests over real model tests for normal CI because they are deterministic, cheap, and do not require authentication.
- Use real Codex only in explicit smoke tests.
- Test public behavior through CLI, MCP tools/resources, generated schemas, and daemon API effects rather than private implementation details.
- Test schema validation for sessions, task groups, tasks, attempts, results, artifacts, events, and effective config.
- Test config layering and strict unknown-key behavior.
- Test OS-native storage path resolution without writing outside test temp roots.
- Test SQLite migrations with temporary databases.
- Test worktree creation, harness file creation, local exclude behavior, result parsing, artifact registration, log capture, and patch generation.
- Test malformed, missing, wrong-task, and wrong-attempt result files as failed-contract outcomes.
- Test subagent blocked, failed, completed, cancelled, timed-out, interrupted, and completed-with-failed-verification flows.
- Test infrastructure retry creates a new task attempt and fresh worktree while preserving failed-attempt evidence.
- Test daemon restart behavior by marking running tasks interrupted and resuming queued tasks.
- Test queue limits, priority inheritance, group budget exhaustion policies, and deterministic duplicate warnings.
- Test cancellation idempotency for task, task group, and session targets.
- Test runtime verification command capture and failure semantics.
- Test MCP tool schemas, structured outputs, and resource reads against the same daemon paths.
- Test MCP path hiding and CLI path visibility/redaction behavior.
- Test stable resource URI resolution for schemas and artifacts.
- Test session brief optimistic concurrency and task group expected revision checks.
- Test explicit revision-conflict override records an event.
- Test effective config output redacts secrets and optionally redacts sensitive paths.
- Test doctor output in human and JSON modes without model calls.
- Test adapter health checks without model calls.
- Test fake Codex command templating before real Codex smoke.
- Test optional real-Codex smoke against a tiny temporary repo when explicitly enabled.
- Test merge of non-conflicting selected task attempts into an integration worktree.
- Test merge conflict reporting and preservation of the integration worktree.
- Test that harness files are excluded from merge/user diffs.
- Test skill path behavior for repo-relative paths, user-allowlisted absolute paths, symlink default, copy strategy, and read-only policy reporting.
- Test redaction markers and optional keyed fingerprints without asserting impossible perfect secrecy.
- Test local-only metrics for queue wait, task duration, adapter failures, retries, verification outcome, and estimated/reported usage.

## Out of Scope

- Runtime planning or task decomposition.
- Recursive subagent delegation.
- Automatic merge of task outputs.
- Automatic conflict resolution by another subagent.
- Provider/model API secret storage.
- Public cloud service.
- Cursor, Antigravity, or Grok as subagents.
- Antigravity host setup in v1.
- Rich GUI or Manager view.
- Mid-task subagent-to-orchestrator elicitation.
- Exact token/cost accounting for every process-backed adapter.
- Automatic LLM summarization of full transcripts.
- Remote-machine or cluster scheduling.
- GitHub issue or pull request workflow integration in core.
- Session templates as a runtime feature.
- MCP prompts.
- OpenAPI/private daemon API docs.
- Shell completions.
- Session import.
- Runtime-managed shared dependency cache.
- Full encryption-at-rest support.

## Further Notes

The initial implementation should follow five vertical slices:

1. Fake adapter end-to-end: daemon, SQLite, CLI, fake adapter, worktree, result parsing, and query results.
2. MCP tools/resources over the same daemon paths.
3. Codex adapter smoke path.
4. Merge/integration worktree for selected winners.
5. Doctor and effective config.

The first implementation goal is not to maximize adapter breadth. It is to prove
that the control plane can run, supervise, validate, and aggregate many isolated
task attempts through deterministic tests. Once that is reliable, real Codex
behavior and Cursor MCP usage become much lower-risk integration work.
