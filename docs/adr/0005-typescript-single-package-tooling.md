# ADR 0005: Use a Single TypeScript Package for v1 Tooling

## Status

Accepted.

## Context

v1 needs a daemon, MCP server, CLI, Codex adapter, schemas, SQLite persistence,
and a fake-adapter integration test harness. The architecture may eventually
split into multiple packages or external adapter processes, but the initial
seams are not proven yet.

The implementation options included a single TypeScript package, a Go or Rust
core with a TypeScript MCP shim, or a pnpm workspace from day one.

## Decision

Use one TypeScript/Node package for v1, managed by `pnpm`, with package-like
internal folder boundaries.

Use:

- MCP TypeScript SDK for the MCP server.
- `tsx` for development execution.
- `tsup` for distributable bundles.
- `tsc --noEmit` for typechecking.
- Vitest for tests.
- Zod as the schema source of truth.
- Commander.js for the CLI.
- Fastify for the private daemon API.
- Pino for structured logging (not yet wired in v1).
- `better-sqlite3` for SQLite.

## Rationale

The official MCP TypeScript SDK gives the shortest path to a correct MCP server
with tool schemas and structured results. A single TypeScript runtime avoids
cross-language IPC and multi-package release overhead before the product shape
is proven.

The chosen libraries are boring, common, and directly aligned with the needs of
the daemon: schema validation, process supervision, local HTTP/socket API,
structured logs, SQLite state, and CLI help.

## Consequences

- v1 build, tests, and package publishing stay simple.
- Internal boundaries must be kept clean enough to extract later.
- CPU-heavy or highly concurrent core work can be split into another language
  later if real measurements justify it.
- The package can still publish through npm even though development uses `pnpm`.
