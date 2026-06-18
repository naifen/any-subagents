# AGENTS.md

## Project overview

`any-subagents` is a provider-neutral local control plane for process-backed subagents. It schedules, supervises, and aggregates work performed by LLM agent runtimes in isolated git worktrees. The two entry points are a CLI (`any-subagents`) and an MCP server (`any-subagents-mcp`).

- **Language**: TypeScript (ESM, strict mode, `ES2022` target)
- **Runtime**: Node ≥ 22.13
- **Package manager**: pnpm 11.7.0 (corepack-managed)
- **Single-package repo** — no workspace packages; `pnpm-workspace.yaml` exists only for native build allowlists (`better-sqlite3`, `esbuild`).

## Setup commands

```sh
corepack enable            # activate the pinned pnpm version
pnpm install               # install all dependencies
pnpm build                 # generate JSON schemas then bundle with tsup
```

## Development workflow

```sh
pnpm dev:cli               # run the CLI entry point via tsx
pnpm dev:mcp               # run the MCP server entry point via tsx
pnpm typecheck             # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
```

No linter or formatter is configured. Match existing code style when making changes.

## Testing instructions

- **Framework**: Vitest 4 (`test/**/*.test.ts`, Node environment, 30 s timeout).
- Run all tests: `pnpm test`
- Watch mode: `pnpm test:watch`
- Run a single test file: `pnpm vitest run test/<name>.test.ts`
- Focus on one test: `pnpm vitest run -t "<test name>"`

Test files live in `test/` and mirror source modules:

| Test file | Covers |
| --- | --- |
| `control-plane.test.ts` | Core control-plane orchestration |
| `store.test.ts` | SQLite persistence layer |
| `lifecycle.test.ts` | Task lifecycle state machine |
| `mcp.test.ts` | MCP server tools |
| `daemon.test.ts` | Fastify daemon app |
| `cli.test.ts` | CLI command parsing |
| `codex-adapter.test.ts` | Codex adapter |
| `exec.test.ts` | Child-process execution |
| `merge.test.ts` | Git merge logic |
| `schemas.test.ts` | JSON schema generation |
| `doctor.test.ts` | Environment diagnostics |

There is no coverage threshold configured. Add or update tests for every code change.

## Build and deployment

- **Bundler**: tsup (ESM only, sourcemaps, dts, `better-sqlite3` external).
- **Build**: `pnpm build` → generates JSON schemas via `tsx src/schemas/write-json-schemas.ts`, then bundles `src/cli/main.ts` → `dist/cli.js` and `src/mcp/main.ts` → `dist/mcp.js`.
- **Schema generation**: `pnpm schemas` — regenerates `schemas/*.schema.json` from Zod definitions in `src/schemas/`.
- **Published files**: `dist/`, `schemas/`, `docs/`.
- **Binaries**: `any-subagents` (`dist/cli.js`), `any-subagents-mcp` (`dist/mcp.js`).

## CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to `main` with four parallel jobs:

1. **Typecheck** — `pnpm typecheck`
2. **Test** — `pnpm test`
3. **Build** — `pnpm build` then verifies `dist/cli.js` and `dist/mcp.js` exist
4. **Schema Freshness** — `pnpm schemas` then `git diff --exit-code schemas/`

All jobs use Node 22. Before submitting a PR, ensure all four pass locally:

```sh
pnpm typecheck && pnpm test && pnpm build && pnpm schemas && git diff --exit-code schemas/
```

## Source architecture

```text
src/
├── adapters/      # Runtime-specific integrations (codex.ts, fake-script.ts)
├── cli/           # Commander-based CLI entry point (main.ts, program.ts)
├── core/          # Control plane, task runner, scheduler, lifecycle, exec, harness
├── daemon/        # Fastify HTTP daemon (app.ts)
├── db/            # SQLite persistence (store.ts via better-sqlite3)
├── mcp/           # MCP server (main.ts, server.ts via @modelcontextprotocol/sdk)
├── schemas/       # Zod schemas → JSON schema generation
├── storage/       # File-system storage utilities
└── test-support/  # Shared test helpers
```

## Code style

- ESM (`"type": "module"`); use `.js` extensions in relative imports.
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`.
- No linter or formatter is configured — match the conventions already in the file you're editing.
- Use the domain vocabulary from `CONTEXT.md` (see Domain docs below). Don't drift to synonyms the glossary explicitly avoids.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `naifen/any-subagents`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. See `docs/agents/domain.md`.
