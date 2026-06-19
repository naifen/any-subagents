# ADR 0007: Adapter Synthesizes result.json from Codex JSONL

## Status

Accepted.

## Context

Subagents must write a validated `result.json` contract after each attempt.
The Codex CLI can run non-interactively via `codex exec` and emits structured
JSON Lines events on stdout when `--json` is enabled.

Two approaches exist:

1. Instruct the Codex subagent to read harness files and write
   `.any-subagents/result.json` itself.
2. Have the any-subagents Codex adapter parse `codex exec --json` output and
   synthesize `result.json` after the process exits.

## Decision

The Codex adapter synthesizes `result.json` from `codex exec --json` JSONL
output. The adapter does not rely on the subagent writing the result contract.

## Rationale

- **Robustness**: Does not depend on agent compliance with an unfamiliar file
  contract in the worktree harness.
- **Model quality independence**: Works regardless of whether the model follows
  instructions to write structured output files.
- **Structured telemetry**: `--json` provides typed events (`item.completed`,
  `turn.completed`, file changes, usage) suitable for deterministic synthesis.

## Consequences

- The adapter must parse Codex JSONL events and map them to `ResultEnvelope`
  fields (`summary`, `changes`, `findings`, `usage`).
- Prompt composition for Codex tasks is adapter-owned (`renderCodexPrompt`) and
  does not depend on harness instruction files for the result contract.
- Other adapters may choose either synthesis or subagent-authored results; Codex
  uses synthesis in v1.
