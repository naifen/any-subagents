# v1 Gap Analysis — Corrected Requirement Coverage

Source of truth: PRD Issue #1 (80 user stories) + the Codex-adapter comment.
This corrects and extends an earlier evaluation report. Decisions for closing
the gaps are recorded in [ADR-0008](../adr/0008-close-v1-prd-implementation-gaps.md).

Build evidence at close-out: **96 tests pass** (20 files), `tsc --noEmit` clean.

## Status legend

- **Done** — implemented and tested.
- **Partial** — partially implemented; specifics noted.
- **Missing** — not implemented.

## Coverage matrix

| Stories | Area | Status | Evidence / note |
| :--- | :--- | :---: | :--- |
| 1–3, 30, 35–37 | Sessions & briefs, optimistic concurrency | Done | `control-plane.ts` createSession / updateSessionBrief / getSessionDigest |
| 4, 5, 10–12 | Task groups, independent tasks, mode + required write scope | Done | `submitTaskGroup`; `taskEnvelopeSchema` superRefine |
| 6, 65, 78 | Durable queue, SQLite, bounded concurrency | Done | Priority scheduler + global/provider/repo/group limits |
| 7 | Global/provider/repo/group limits | Partial | `limit-policy.ts` + config; per-task limits not implemented |
| 8 | Priority inheritance | Done | Session → group → task in `submitTaskGroup`; session priority persisted |
| 9 | Deterministic duplicate warnings | Done | `task_group.duplicate_warning` event in `submitTaskGroup` |
| 13–15 | Model/reasoning request, fail-by-default, explicit fallback | Done | Profile allowlists + fallback events in `submitTaskGroup` |
| 16 | Record requested + effective model/reasoning per attempt | Done | `task-runner.ts` populates attempt fields |
| 17–19, 77 | Sandbox/permission/command policy, security presets | Done | Profile config + attempt recording in `task-runner.ts` |
| 18 | Network/package-install policy visible per attempt | Done | `network_policy` / `package_install_policy` on attempts |
| 20–22 | Stable task identity, multiple attempts, attempt access | Done | `store.ts` attempt tracking |
| 23 | Infra retry in fresh worktree (new attempt) | Partial | Only `git worktree add` retried; no attempt-level infra retry |
| 24 | No auto-retry on semantic failure | Done | Scheduler does not auto-retry |
| 25 | Running → interrupted + resume queued on restart | Done | Atomic `store.recoverInterrupted()` in ControlPlane constructor |
| 26 | Blocked is terminal | Done | `status.ts` terminal set |
| 27–29 | Structured results, task+attempt ID required, malformed → failed_contract | Done | `parseResultFile`, `synthesizeResult` |
| 31 | Artifact previews + resource URIs | Done | `createArtifact` sets preview + `resource_uri` |
| 32 | Hide raw paths in MCP | Done | ControlPlane audience is `"public"` at MCP bootstrap; paths stripped on read |
| 33 | CLI shows paths | Done | ControlPlane audience is `"internal"` at CLI bootstrap; full records returned |
| 34, 48 | Untrusted evidence, strict harness | Done | Harness writes envelope/brief/instructions/schema/artifacts |
| 38 | Revision-override recorded as event | Done | `session.revision_override` event |
| 39, 40 | Idempotent cancel, graceful stop | Done | `cancelTasks`; SIGTERM before settle |
| 41, 42 | Runtime verification + distinct failed-verification status | Done | `runVerification`, `completed_with_failed_verification` |
| 43–45 | Patch artifacts + changed-file stats, explicit merge to integration worktree | Partial | Patch artifact for write tasks + merge done; per-attempt changed-file stats not computed |
| 46 | Merge conflicts as events/artifacts | Done | `merge.conflict` event + diff artifact persisted |
| 47, 51 | No recursive delegation; harness says so | Done | Anti-recursion line in `renderInstructions` |
| 49, 50, 52 | Native skill discovery, read-only skill mounts, prioritise verification cmds | Done | `skills.ts` mount + harness verification priority |
| 53 | CLI mirrors MCP | Done | merge, update-brief, digest, artifact get, metrics, export |
| 54–56 | CLI help/version/JSON, doctor, effective config | Done | `program.ts`, `doctor`, `getEffectiveConfig` |
| 57, 58, 75, 76 | Secret + optional path redaction, documented imperfect | Done | `redaction.ts` applied in harness/logs/previews |
| 59 | OS-native storage | Done | `storage/paths.ts` |
| 60, 61 | Export-only bundles (JSON + optional Markdown) | Done | `exportSession`, CLI/MCP export |
| 62, 63 | JSON Schemas from Zod, strict validation | Done | `schemas/index.ts`, generated schemas |
| 64 | Append-only scoped events | Done | `appendEvent` |
| 66 | Forward migrations with backup | Done | `db/migrations.ts` numbered migrations + backup |
| 67 | Local-only metrics | Done | metrics table, CLI/MCP/daemon, TaskRunner/Scheduler emit |
| 68, 70 | Fake-adapter tests, single TS package | Done | Test suite; single package |
| 71, 72 | Adapter capability metadata, Codex-first boundary | Done | Enriched `listAdapters` |
| 73 | Cursor MCP setup snippet / installer | Done | `docs/cursor-mcp-setup.md` |
| 74 | No provider secrets stored | Done | None stored |
| 79 | Compact digests/previews | Done | `buildSessionDigest`, previews |
| 80 | Stable MCP resource URIs (schemas + session/task/artifact views) | Done | Schema + session/task/artifact MCP resources |
| — | Preflight: refuse dirty source repo | Done | `assertCleanRepo` in `createSession` |

## Corrections to the prior report

- **Story 53 (CLI mirrors MCP)** was marked Passed; it is now **Done**.
- **Story 16 (per-attempt model/reasoning recording)** is **Done**.
- **Story 32 path leak** is **Done** via instance-bound ControlPlane audience (`"public"` for MCP).
- **Stories 43–45** remain **Partial** for per-attempt changed-file stats only.

## Remaining partial items (explicitly out of slice scope)

- **Story 7**: per-task concurrency limits (global/provider/repo/group/profile limits are implemented).
- **Story 23**: attempt-level infra retry beyond worktree creation retry.
- **Stories 43–45**: per-attempt changed-file stats (merge-time stats only).
- **Budget exhaustion**: `budget_exhaustion_policy` config enables capacity preemption via `cancel_running`; session/group budget tracking not implemented.
