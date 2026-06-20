# ADR 0009: v1 Close-Out — Adapter-Boundary Deferrals

## Status

Accepted. Supersedes portions of [ADR-0008](./0008-close-v1-prd-implementation-gaps.md)
(see Context).

## Context

**Supersedes portions of [ADR-0008](./0008-close-v1-prd-implementation-gaps.md):**
control-plane permission/command validation (ADR-0008 §8), full security-preset
implementation scope, token/cost budget enforcement, and attempt-level infra
retry. ADR-0008 remains authoritative for everything else it closed (restart
recovery, path hiding, skills, redaction, concurrency limits, etc.).

Issue #1 tracks 80 PRD user stories against the v1 implementation. A code audit
found three **confirmed** gaps still requiring code (fail-by-default model/reasoning,
security presets, and budget clarity) plus several **debatable** items where the
control plane already records policy metadata but full runtime validation would
duplicate adapter-native sandbox enforcement.

Re-litigating every debatable story would delay v1 close-out without improving
real-world safety — adapters already enforce permissions, sandbox mode, and
command boundaries. The gap analysis in
[`docs/design/v1-gap-analysis.md`](../design/v1-gap-analysis.md) is the
authoritative status matrix after this ADR.

## Decision

Close v1 with the following hard-to-reverse forks:

### 1. Token/cost budgets deferred

Story 7 **concurrency** limits (global, provider, repo, group, profile) are
fulfilled via `limit-policy.ts` and `capacity_preemption_policy`. Session/group/task
`budgets` fields remain schema metadata only. Token/cost budget **enforcement**
is deferred until usage is reliably aggregated from adapter attempts (today:
best-effort per-attempt usage in Codex events, no SQLite roll-up). Follow-up
work may open a separate issue; it does not block Issue #1 close-out.

### 2. Security validation boundary

Stories 17–19: the control plane records requested and effective permissions,
sandbox, network, and package-install policy on each attempt. **Adapter-native
sandbox** is the primary enforcement boundary in v1. Control-plane narrow/broaden
validation of task-level permission overrides and command allow/deny lists is
deferred.

### 3. Daemon operational model

v1 embeds an in-process `ControlPlane` per entry point (MCP server, CLI, daemon).
**MCP is the long-lived owner** when supervising active work; CLI is ephemeral
admin/read-only. A shared daemon remains the target architecture but is not
required for v1 close-out.

**Boot warning:** any CLI or MCP boot runs restart recovery (`recoverInterrupted`)
against shared SQLite. Starting a second entry point while another supervises
active work can race on the same database.

### 4. Partial items accepted as-is

| Story | v1 acceptance |
| --- | --- |
| 43 | Patch artifacts + merge-time stats; no per-attempt line stats |
| 40 | SIGTERM on cancel; no SIGKILL escalation |
| 23 | Worktree creation retried in-place; new-attempt infra retry is orchestrator-driven |
| 80 | MCP resources for schemas/session/task/artifact; config via `get_effective_config` tool |

## Consequences

- Phases 1–2 code scope is limited to Stories 14–15 (fail-by-default +
  `allow_fallback`) and Story 77 (security presets).
- Gap matrix rows for debatable/downgrade items reflect Partial or Deferred
  status with ADR-0009 cross-links.
- PRD user stories stay aspirational; Implementation Decisions and gap analysis
  carry the v1 operational truth.
- Post-v1 backlog (budget enforcement, shared daemon, control-plane validation)
  may get separate issues without blocking Issue #1 close.

## References

- [v1 Gap Analysis](../design/v1-gap-analysis.md)
- [PRD Implementation Decisions](../design/prd-v1-local-control-plane.md#implementation-decisions)
- [ADR-0008](./0008-close-v1-prd-implementation-gaps.md)
