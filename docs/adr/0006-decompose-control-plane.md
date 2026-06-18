# ADR 0006: Decompose Control Plane into Scheduler, Task Runner, and Lifecycle Modules

## Status

Accepted.

## Context

The initial v1 implementation placed scheduling, process supervision, worktree
management, harness writing, result parsing, verification, evidence
registration, and state transitions in a single `ControlPlane` class (~944
lines). Every terminal path (completion, cancellation, timeout, error) had its
own copy of the three-step state update: update attempt, update task, re-derive
group status. Bugs appeared when one path missed a step.

## Decision

Decompose the control plane into dedicated modules with single
responsibilities:

- `ControlPlane` — API surface, session/task CRUD, merge, cancellation.
- `Scheduler` — concurrency queue, dispatch, completion tracking.
- `TaskRunner` — single-attempt lifecycle: worktree creation, harness setup,
  adapter execution, result parsing, verification, evidence registration.
- `lifecycle.ts` / `finalizeAttempt` — the single function through which all
  terminal state transitions flow.
- `status.ts` — `TaskRuntimeStatus` and `GroupStatus` type definitions,
  `terminalStatuses` and `failureStatuses` sets, and `deriveGroupStatus`.
- `harness.ts` — harness directory file writing.
- `exec.ts` — child-process execution helpers.
- `errors.ts` — domain error types.

All terminal paths (TaskRunner completion, TaskRunner early-cancel, Scheduler
error catch, ControlPlane cancel) must route through `finalizeAttempt`.

## Rationale

The monolithic class mixed orchestration, process supervision, filesystem I/O,
and state transitions. Decomposition makes each concern independently testable,
reduces merge conflicts, and makes the codebase more navigable for both humans
and AI agents.

Centralising terminal transitions in `finalizeAttempt` eliminates the class of
bugs where one path updates the attempt but forgets the group status, or vice
versa.

## Consequences

- New terminal paths must call `finalizeAttempt` rather than updating
  attempt/task/group status directly.
- The `ControlPlane` class remains the public API surface; internal modules are
  not part of the external contract.
- Test coverage can target each module independently (`lifecycle.test.ts`,
  `exec.test.ts`, `store.test.ts`) rather than requiring full integration
  tests for every state transition.
