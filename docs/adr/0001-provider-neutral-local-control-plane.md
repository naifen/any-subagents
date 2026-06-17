# ADR 0001: Use a Provider-Neutral Local Control Plane

## Status

Accepted.

## Context

`any-subagents` should let one LLM agent orchestrate many other LLM agent
runtimes. The initial target combinations include Cursor to Codex and
Antigravity to Codex, with room for Codex, Cursor, Antigravity, Grok, and other
agents as either orchestrators or subagents later.

A Cursor-first plugin would be faster to frame, but it would couple the core
architecture to one host and make later host support a retrofit.

## Decision

Build a provider-neutral local control plane as the core runtime. Host-specific
integrations are thin adapters over the same daemon and API surface.

## Rationale

The product goal is cross-agent orchestration, not a Cursor-only automation.
A provider-neutral runtime keeps scheduling, worktree isolation, process
supervision, durable state, artifacts, budgets, and aggregation independent of
any one orchestrator host.

This also lets v1 focus on one strong subagent adapter, Codex, while still
leaving the orchestration model open to Cursor, Antigravity, Codex, and other
hosts.

## Consequences

- The core nouns and schemas must avoid host-specific assumptions.
- Host integrations should stay thin and replaceable.
- The daemon must own runtime state instead of relying on a single host session.
- Initial host documentation can still prioritize Cursor.
