# v1 Gap Analysis — Corrected Requirement Coverage

Source of truth: PRD Issue #1 (80 user stories) + the Codex-adapter comment.
This corrects and extends an earlier evaluation report. Decisions for closing
the gaps are recorded in [ADR-0008](../adr/0008-close-v1-prd-implementation-gaps.md).

Build evidence at audit time: **78 tests pass** (13 files), `tsc --noEmit`
clean.

## Status legend

- **Done** — implemented and tested.
- **Partial** — partially implemented; specifics noted.
- **Missing** — not implemented.

## Coverage matrix

| Stories | Area | Status | Evidence / note |
| :--- | :--- | :---: | :--- |
| 1–3, 30, 35–37 | Sessions & briefs, optimistic concurrency | Done | `control-plane.ts` createSession / updateSessionBrief / getSessionDigest |
| 4, 5, 10–12 | Task groups, independent tasks, mode + required write scope | Done | `submitTaskGroup`; `taskEnvelopeSchema` superRefine |
| 6, 65, 78 | Durable queue, SQLite, bounded concurrency | Partial | Global concurrency only; durable queue works |
| 7 | Global/provider/repo/group/task limits | Missing | Scheduler has only `maxConcurrency` |
| 8 | Priority inheritance | Missing | `priority` in schemas but ignored and never forwarded by control plane |
| 9 | Deterministic duplicate warnings | Missing | No dedup in `submitTaskGroup` |
| 13–15 | Model/reasoning request, fail-by-default, explicit fallback | Partial | Forwarded to Codex; no allowlist/validation/fallback |
| 16 | Record requested + effective model/reasoning per attempt | Missing | Attempt schema has fields; `TaskRunner` never populates them |
| 17–19, 77 | Sandbox/permission/command policy, security presets | Missing | Fields exist; never enforced/recorded. No profile system; preset hardcoded `default` |
| 18 | Network/package-install policy visible per attempt | Missing | Not recorded |
| 20–22 | Stable task identity, multiple attempts, attempt access | Done | `store.ts` attempt tracking |
| 23 | Infra retry in fresh worktree (new attempt) | Partial | Only `git worktree add` retried; no attempt-level infra retry |
| 24 | No auto-retry on semantic failure | Done | Scheduler does not auto-retry |
| 25 | Running → interrupted + resume queued on restart | Missing | `interrupted` only in status/schema; no boot recovery |
| 26 | Blocked is terminal | Done | `status.ts` terminal set |
| 27–29 | Structured results, task+attempt ID required, malformed → failed_contract | Done | `parseResultFile`, `synthesizeResult` |
| 31 | Artifact previews + resource URIs | Done | `createArtifact` sets preview + `resource_uri` |
| 32 | Hide raw paths in MCP | Partial | Artifacts hidden, **but `get_task_result` leaks `worktree_path`, `log_path`, `result_path`** |
| 33 | CLI shows paths | Done | CLI returns full records |
| 34, 48 | Untrusted evidence, strict harness | Done | Harness writes envelope/brief/instructions/schema/artifacts |
| 38 | Revision-override recorded as event | Missing | Override skips throw; no event |
| 39, 40 | Idempotent cancel, graceful stop | Done | `cancelTasks`; SIGTERM before settle |
| 41, 42 | Runtime verification + distinct failed-verification status | Done | `runVerification`, `completed_with_failed_verification` |
| 43–45 | Patch artifacts + changed-file stats, explicit merge to integration worktree | Partial | Patch artifact for write tasks + merge done; per-attempt changed-file stats not computed |
| 46 | Merge conflicts as events/artifacts | Missing | Conflicts returned to caller only; no event/artifact persisted |
| 47, 51 | No recursive delegation; harness says so | Missing | Harness instructions omit anti-recursion line |
| 49, 50, 52 | Native skill discovery, read-only skill mounts, prioritise verification cmds | Missing | No mounting logic; `skill_paths: []` advertised only |
| 53 | CLI mirrors MCP | Partial | CLI missing `merge`, `update-session-brief`, `get-session-digest`, `get-artifact` |
| 54–56 | CLI help/version/JSON, doctor, effective config | Done | `program.ts`, `doctor`, `getEffectiveConfig` |
| 57, 58, 75, 76 | Secret + optional path redaction, documented imperfect | Missing | Hardcoded `path_redaction:false`, `redactions:[]`; no scanning |
| 59 | OS-native storage | Done | `storage/paths.ts` |
| 60, 61 | Export-only bundles (JSON + optional Markdown) | Missing | No export command/logic |
| 62, 63 | JSON Schemas from Zod, strict validation | Done | `schemas/index.ts`, generated schemas |
| 64 | Append-only scoped events | Done | `appendEvent` |
| 66 | Forward migrations with backup | Missing | Schema created; no version/migrate/backup |
| 67 | Local-only metrics | Missing | No metrics anywhere |
| 68, 70 | Fake-adapter tests, single TS package | Done | Test suite; single package |
| 71, 72 | Adapter capability metadata, Codex-first boundary | Partial | `listAdapters` minimal capability surface |
| 73 | Cursor MCP setup snippet / installer | Missing | No `mcpServers` snippet in docs/README |
| 74 | No provider secrets stored | Done | None stored |
| 79 | Compact digests/previews | Done | `getSessionDigest`, previews |
| 80 | Stable MCP resource URIs (schemas + session/task/artifact views) | Partial | Only `schemas/*` registered as resources |
| — | Preflight: refuse dirty source repo | Missing | `createSession` checks repo+ref only |

## Corrections to the prior report

- **Story 53 (CLI mirrors MCP)** was marked Passed; it is **Partial** — the CLI
  omits merge, brief update, session digest, and get-artifact.
- **Story 16 (per-attempt model/reasoning recording)** was folded into "forwarding
  works" but is independently **Missing**.
- **Story 32 path leak** affects **three** fields (`worktree_path`, `log_path`,
  `result_path`), not two.
- **Stories 43–45** were marked Passed; the **changed-file stats** half is weaker
  (stats only computed during merge, not per attempt).

## Gaps the prior report omitted entirely

Skills (49, 50, 52), local metrics (67), DB migrations + backup (66),
dirty-repo preflight, and per-attempt sandbox/network policy recording
(17–19) were not in the prior matrix. All are scoped into v1 by ADR-0008.
