# ADR 0002: Run Real Subagent Processes in Isolated Worktrees

## Status

Accepted.

### v1 Implementation Notes

- The `fake` adapter is the only adapter that can run tasks end-to-end. The
  Codex adapter (`src/adapters/codex.ts`) provides health-check and smoke-test
  only; `TaskRunner.runAdapter()` throws for any adapter other than `fake`.
- Worktree retention and cleanup are not implemented. Worktrees accumulate
  until manually pruned.

## Context

The tool needs to support 10-20 normal subagents and a theoretical stress
envelope of 100+ queued tasks. Subagents may edit code, run tests, create
artifacts, and produce competing solutions that the orchestrator compares.

One option is to implement generic LLM API workers and build an agent loop in
the runtime. Another option is to launch existing agent runtimes as external
processes.

## Decision

v1 subagents are real agent runtimes launched as external processes. Each task
runs in its own git worktree.

The first built-in subagent adapter is Codex. The target launch mode is
non-interactive prompt execution, with PTY control only as a fallback if needed.

## Rationale

Real agent runtimes preserve each tool's own sandboxing, model selection,
approval behavior, local config, and coding workflow. This avoids rebuilding
Codex or another agent loop inside `any-subagents`.

Separate worktrees give each task clean filesystem isolation, independent diffs,
parallel test execution, and reviewable results. They also prevent many agents
from interleaving edits in one shared checkout.

## Consequences

- The runtime must supervise child processes, logs, timeouts, cancellation, and
  graceful shutdown.
- The runtime must manage worktree creation, naming, retention, and merge
  attempts.
- Result contracts must be file-based and validated after process exit.
- Shared dependency/cache optimization is left to existing package-manager
  caches in v1.
