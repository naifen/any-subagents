# ADR 0003: Expose MCP as the Primary Agent API and CLI as the Admin API

## Status

Accepted.

### v1 Implementation Notes

- v1 MCP and CLI both instantiate `ControlPlane` in-process rather than
  connecting to a running daemon. The Fastify daemon (`src/daemon/app.ts`)
  exists and is tested but is not wired as the canonical runtime.
- Unix sockets and auth-token-protected loopback TCP are not implemented.

## Context

Orchestrator agents need a standard way to create sessions, submit task groups,
query compact results, inspect artifacts/logs, cancel work, and merge selected
winners. Humans and tests need a way to inspect and control the same runtime
without relying on an IDE host.

The main API options were MCP, CLI-only, HTTP-only, or making every surface
public at once.

## Decision

Use MCP as the primary agent-facing API. Provide a single `any-subagents` CLI
for humans, tests, debugging, and daemon/admin commands.

Both MCP and CLI are thin clients over a private local daemon API. The local
daemon owns process supervision and durable state.

## Rationale

MCP gives agent hosts a standard tool surface with structured schemas. A CLI is
still necessary for setup, help, smoke tests, logs, status, cancellation, and
repeatable integration tests.

Keeping MCP and CLI thin avoids split-brain process supervision. One daemon owns
queues, state transitions, logs, artifacts, and child processes.

## Consequences

- MCP tool definitions need clear descriptions, input schemas, and structured
  output schemas where practical.
- CLI commands should mirror MCP operations and support `--help`, `help`,
  `--version`, stable exit codes, human output, and `--json`.
- The private daemon API is not a public v1 integration contract.
- The daemon should use Unix sockets by default on macOS/Linux, with optional
  loopback TCP protected by an auth token.
