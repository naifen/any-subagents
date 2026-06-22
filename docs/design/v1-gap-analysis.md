# v1 Gap Analysis — Corrected Requirement Coverage

Source of truth: PRD Issue #1 (80 user stories) + the Codex-adapter comment.
This corrects and extends an earlier evaluation report. Decisions for closing
the gaps are recorded in [ADR-0008](../adr/0008-close-v1-prd-implementation-gaps.md)
and [ADR-0009](../adr/0009-v1-close-out-adapter-boundary.md).

Build evidence at close-out: **148 tests pass** (27 files), `tsc --noEmit` clean, schemas fresh.

## Status legend

- **Done** — implemented and tested.
- **Partial** — partially implemented; specifics noted.
- **Missing** — not implemented.
- **Deferred (adapter-boundary)** — v1 records policy metadata; adapter-native
  sandbox is the enforcement boundary (see ADR-0009).

## Tag legend

- **Confirmed** — must ship in this close-out slice (Phases 1–2).
- **Debatable** — adapter-boundary deferral per ADR-0009; documented, no code.
- **Downgrade** — prior report overstated Done; relabeled Partial or Deferred.

## Coverage matrix

| Stories | Area | Status | Tag | Evidence / note |
| :--- | :--- | :---: | :---: | :--- |
| 1–3, 30, 35–37 | Sessions & briefs, optimistic concurrency | Done | — | `control-plane.ts` createSession / updateSessionBrief / getSessionDigest |
| 4, 5, 10–12 | Task groups, independent tasks, mode + required write scope | Done | — | `submitTaskGroup`; `taskEnvelopeSchema` superRefine |
| 6, 65, 78 | Durable queue, SQLite, bounded concurrency | Done | — | Priority scheduler + global/provider/repo/group limits |
| 7 | Global/provider/repo/group limits; token/cost budgets | Partial | Debatable | **Concurrency: Done** (`limit-policy.ts` + config). **Budget enforcement: deferred** — schema fields retained per ADR-0009 |
| 8 | Priority inheritance | Done | — | Session → group → task in `submitTaskGroup`; session priority persisted |
| 9 | Deterministic duplicate warnings | Done | — | `task_group.duplicate_warning` event in `submitTaskGroup` |
| 13–15 | Model/reasoning request, fail-by-default, explicit fallback | Done | — | `task-policy.ts` `TaskPolicyError` + `allow_fallback` on submit; `test/task-policy.test.ts`, `test/control-plane.test.ts` |
| 16 | Record requested + effective model/reasoning per attempt | Done | — | `task-runner.ts` populates attempt fields |
| 17–19 | Sandbox/permission/command policy validation | Deferred (adapter-boundary) | Debatable | Control plane records requested/effective policy on attempts; adapter sandbox is enforcement boundary (ADR-0009) |
| 18 | Network/package-install policy visible per attempt | Done | — | `network_policy` / `package_install_policy` on attempts (recording only; validation deferred with 17–19) |
| 20–22 | Stable task identity, multiple attempts, attempt access | Done | — | `store.ts` attempt tracking |
| 23 | Infra retry in fresh worktree (new attempt) | Partial | Debatable | Only `git worktree add` retried in-place; new-attempt infra retry is orchestrator-driven (ADR-0009) |
| 24 | No auto-retry on semantic failure | Done | — | Scheduler does not auto-retry |
| 25 | Running → interrupted + resume queued on restart | Done | — | Atomic `store.recoverInterrupted()` in ControlPlane constructor |
| 26 | Blocked is terminal | Done | — | `status.ts` terminal set |
| 27–29 | Structured results, task+attempt ID required, malformed → failed_contract | Done | — | `parseResultFile`, `synthesizeResult` |
| 31 | Artifact previews + resource URIs | Done | — | `createArtifact` sets preview + `resource_uri` |
| 32 | Hide raw paths in MCP | Done | — | ControlPlane audience is `"public"` at MCP bootstrap; paths stripped on read |
| 33 | CLI shows paths | Done | — | ControlPlane audience is `"internal"` at CLI bootstrap; full records returned |
| 34, 48 | Untrusted evidence, strict harness | Done | — | Harness writes envelope/brief/instructions/schema/artifacts |
| 38 | Revision-override recorded as event | Done | — | `session.revision_override` event |
| 39 | Idempotent cancel | Done | — | `cancelTasks` |
| 40 | Graceful stop | Partial | Downgrade | SIGTERM only; SIGKILL escalation deferred (ADR-0009) |
| 41, 42 | Runtime verification + distinct failed-verification status | Done | — | `runVerification`, `completed_with_failed_verification` |
| 43–45 | Patch artifacts + changed-file stats, explicit merge | Partial | Downgrade | Patch artifact for write tasks + merge done; per-attempt changed-file stats not computed (ADR-0009) |
| 46 | Merge conflicts as events/artifacts | Done | — | `merge.conflict` event + diff artifact persisted |
| 47, 51 | No recursive delegation; harness says so | Done | — | Anti-recursion line in `renderInstructions` |
| 49, 50, 52 | Native skill discovery, read-only skill mounts, prioritise verification cmds | Done | — | `skills.ts` mount + harness verification priority |
| 53 | CLI mirrors MCP | Done | — | merge, update-brief, digest, artifact get, metrics, export |
| 54–56 | CLI help/version/JSON, doctor, effective config | Done | — | `program.ts`, `doctor`, `getEffectiveConfig` |
| 57, 58, 75, 76 | Secret + optional path redaction, documented imperfect | Done | — | `redaction.ts` applied in harness/logs/previews |
| 59 | OS-native storage | Done | — | `storage/paths.ts` |
| 60, 61 | Export-only bundles (JSON + optional Markdown) | Done | — | `exportSession`, CLI/MCP export |
| 62, 63 | JSON Schemas from Zod, strict validation | Done | — | `schemas/index.ts`, generated schemas |
| 64 | Append-only scoped events | Done | — | `appendEvent` |
| 66 | Forward migrations with backup | Done | — | `db/migrations.ts` numbered migrations + backup |
| 67 | Local-only metrics | Done | — | metrics table, CLI/MCP/daemon, TaskRunner/Scheduler emit |
| 68, 70 | Fake-adapter tests, single TS package | Done | — | Test suite; single package |
| 71, 72 | Adapter capability metadata, Codex-first boundary | Done | — | Enriched `listAdapters` |
| 73 | Cursor MCP setup snippet / installer | Done | — | `docs/cursor-mcp-setup.md` |
| 74 | No provider secrets stored | Done | — | None stored |
| 77 | Security presets (`strict` / `default` / `permissive`) | Done | — | `security-presets.ts`, `resolve-profile.ts`, `security_preset` config key; `test/security-presets.test.ts` |
| 79 | Compact digests/previews | Done | — | `buildSessionDigest`, previews |
| 80 | Stable MCP resource URIs | Partial | Downgrade | Schemas/session/task/artifact resources only; config/docs via `get_effective_config` tool, not MCP resource (ADR-0009) |
| — | Preflight: refuse dirty source repo | Done | — | `assertCleanRepo` in `createSession` |

## Corrections to the prior report

- **Stories 13–15** are **Done** — fail-by-default + explicit `allow_fallback` shipped in Phase 1.
- **Stories 17–19** were marked Done; they are **Deferred (adapter-boundary)** —
  metadata recording exists; control-plane validation is deferred.
- **Story 77** is **Done** — security presets shipped in Phase 2.
- **Story 40** was marked Done; it is **Partial** — SIGTERM only.
- **Story 80** was marked Done; it is **Partial** — config/docs not MCP resources.
- **Story 7** concurrency limits are **Done**; token/cost budget enforcement is
  an **accepted v1 deferral** (ADR-0009), not an accidental omission.

## Accepted v1 deferrals (ADR-0009)

These items are explicitly out of the close-out code slice. See
[ADR-0009](../adr/0009-v1-close-out-adapter-boundary.md) for rationale.

| Item | v1 stance |
| --- | --- |
| Token/cost budget enforcement (Story 7) | Schema fields retained; enforcement deferred until usage aggregation lands |
| Permission/command validation (17–19) | Adapter sandbox + attempt metadata |
| Per-attempt changed-file line stats (43) | Patch + path lists sufficient |
| SIGKILL escalation (40) | SIGTERM-only cancel |
| Config/docs MCP resources (80) | `get_effective_config` tool sufficient |
| Auto infra-retry attempts (23) | Orchestrator re-submit |
| Shared daemon | Embedded control plane per entry point; MCP is long-lived owner |
