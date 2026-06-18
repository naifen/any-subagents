<div align="center">

# any-subagents

*Provider-neutral local control plane for process-backed AI subagents*

[![Build Status](https://img.shields.io/github/actions/workflow/status/naifen/any-subagents/ci.yml?style=flat-square&label=CI)](https://github.com/naifen/any-subagents/actions)
![Node version](https://img.shields.io/badge/Node.js-≥22.13-3c873a?style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

⭐ If you like this project, star it on GitHub — it helps a lot!

[Features](#features) · [How It Works](#how-it-works) · [Getting Started](#getting-started) · [Effective Usage](#effective-usage) · [Development](#development)

</div>

---

Schedule, supervise, and aggregate work across multiple LLM agent processes — all from your local machine. `any-subagents` gives an orchestrator agent durable state, isolated worktrees, bounded concurrency, and a structured result contract so you can decompose big tasks into parallel subagent work without vendor lock-in.

> [!TIP]
> `any-subagents` is **adapter-neutral**. It ships with a built-in Codex adapter and a test/fake adapter, but the adapter boundary is designed for future runtimes too.

## Features

- **Session-based orchestration** — Group related tasks into sessions with a shared brief, goals, constraints, and decisions that evolve as work progresses
- **Isolated git worktrees** — Each task attempt runs in its own worktree branched from the session's base ref, preventing cross-task interference
- **Durable state** — SQLite-backed persistence for sessions, task groups, tasks, attempts, artifacts, and events — survives restarts
- **Bounded concurrency** — The scheduler respects per-profile concurrency limits, queuing excess tasks automatically
- **Structured result contract** — Subagents write a validated `result.json` envelope with status, findings, proposed brief updates, and artifact references
- **Dual interfaces** — Full-featured CLI for humans and scripts, plus an MCP server that any orchestrator agent can call as tools
- **Merge integration** — Cherry-pick completed attempt diffs into a single integration worktree for review
- **Environment diagnostics** — Built-in `doctor` command validates your setup without making model calls

## How It Works

```
┌─────────────────┐
│   Orchestrator   │  (your root LLM agent)
│   Agent          │
└────────┬────────┘
         │  create_session / submit_task_group / query_tasks
         ▼
┌─────────────────┐
│  Control Plane   │  any-subagents daemon
│  ┌─────────────┐ │
│  │  Scheduler   │ │  bounded concurrency, retry policy
│  │  Store (SQL) │ │  durable session/task/attempt state
│  │  Harness     │ │  contract-first instruction wrapper
│  └─────────────┘ │
└────────┬────────┘
         │  spawn via adapter (codex, fake-script, …)
    ┌────┴────┬────────┐
    ▼         ▼        ▼
┌────────┐┌────────┐┌────────┐
│Subagent││Subagent││Subagent│  isolated worktrees
│  (wt1) ││  (wt2) ││  (wt3) │  .any-subagents/result.json
└────────┘└────────┘└────────┘
```

The orchestrator creates a **session** tied to a repo and base ref. It then submits **task groups** — each a batch of independent **tasks** within a semantic phase. The control plane schedules tasks through an **adapter** (e.g., Codex), each running as a process in its own git worktree. When a subagent finishes, it writes a structured `result.json` that the control plane collects and surfaces back to the orchestrator.

> [!NOTE]
> See `CONTEXT.md` for the full domain glossary including the precise meanings of *session*, *task group*, *task*, *task attempt*, *adapter*, *profile*, and other terms.

## Getting Started

### Prerequisites

- **Node.js** ≥ 22.13
- **pnpm** 11.7.0 (activated via corepack)
- **Git** (for worktree isolation)

### Install

```bash
corepack enable
git clone https://github.com/naifen/any-subagents.git
cd any-subagents
pnpm install
pnpm build
```

After building, two binaries are available:

| Binary | Entry point | Purpose |
| --- | --- | --- |
| `any-subagents` | `dist/cli.js` | CLI for humans and scripts |
| `any-subagents-mcp` | `dist/mcp.js` | MCP server for orchestrator agents |

### Quick check

```bash
# Verify your environment
any-subagents doctor

# List configured adapters
any-subagents adapters

# Show resolved configuration
any-subagents effective-config
```

## Effective Usage

This section explains how to get real value out of `any-subagents` — whether you're driving it from the CLI, wiring it into an orchestrator agent, or integrating via MCP.

### 1. Structure your work into sessions and task groups

The key mental model is: **session → task groups → tasks**.

```bash
# Create a session anchored to your repo and a stable base ref
any-subagents session create \
  --repo /path/to/your/repo \
  --base-ref main \
  --goal "Migrate authentication from JWT to session tokens" \
  --json
```

A session holds a **brief** — a living document of goals, constraints, decisions, accepted findings, rejected paths, and open questions. The orchestrator owns and evolves this brief as work progresses.

### 2. Submit task groups for each phase

Task groups represent semantic phases. Tasks within a group are independent and can run in parallel.

```bash
# Submit a task group with multiple independent tasks
any-subagents task-group submit --json-input '{
  "session_id": "ses_abc123",
  "title": "Phase 1: Research and spike",
  "expected_brief_revision": 0,
  "tasks": [
    {
      "title": "Audit current JWT usage",
      "instructions": "Find all JWT creation, validation, and refresh points...",
      "mode": "code",
      "adapter": "codex"
    },
    {
      "title": "Spike session-token schema",
      "instructions": "Design the session token DB schema and propose migrations...",
      "mode": "code",
      "adapter": "codex"
    }
  ]
}'
```

> [!IMPORTANT]
> The `expected_brief_revision` field provides optimistic concurrency. If the brief changed since you last read it, the submission will fail — preventing stale-context work.

### 3. Monitor and collect results

```bash
# Query task statuses (optionally filter by session or group)
any-subagents task query --session-id ses_abc123 --json

# Read a specific task's result envelope
any-subagents task result --task-id tsk_xyz789 --json

# Preview task attempt logs
any-subagents task logs --task-id tsk_xyz789
```

### 4. Merge winning attempts

Once you've reviewed results and chosen the best attempts, merge their diffs into an integration worktree:

```bash
# Via MCP (the orchestrator calls merge_tasks)
# This cherry-picks the selected attempt diffs onto the base ref
```

### 5. Use the MCP server for agent-driven orchestration

The MCP server exposes the same capabilities as the CLI, but as tools that orchestrator agents can call programmatically:

| MCP Tool | What it does |
| --- | --- |
| `create_session` | Create a session for a repo and base ref |
| `submit_task_group` | Submit a batch of tasks for scheduling |
| `query_tasks` | Query compact task status summaries |
| `get_task_result` | Read a task result envelope |
| `get_task_logs` | Preview task attempt logs |
| `list_artifacts` | List artifact records |
| `get_artifact` | Read an artifact by ID |
| `update_session_brief` | Update the session brief with concurrency control |
| `get_session_digest` | Read a compact session digest |
| `cancel_tasks` | Cancel tasks, groups, or sessions idempotently |
| `merge_tasks` | Create an integration worktree for selected attempts |
| `get_effective_config` | Read resolved configuration |
| `doctor` | Run setup diagnostics |
| `list_adapters` | List configured adapters |

Start the MCP server with:

```bash
any-subagents-mcp
```

### Tips for effective orchestration

- **Keep briefs concise.** The session brief is shared context for every subagent — bloat degrades quality.
- **One concern per task.** Smaller, focused tasks produce cleaner diffs and more reliable results.
- **Use task groups as phases.** Don't submit phase 2 until phase 1 results are reviewed and the brief is updated.
- **Review before merging.** The result envelope is evidence, not authority. The orchestrator decides what to trust.
- **Let `doctor` catch setup issues early.** Run it before your first session to surface missing dependencies.

## Development

### Setup

```bash
corepack enable
pnpm install
```

### Common commands

```bash
pnpm dev:cli          # Run CLI via tsx (no build needed)
pnpm dev:mcp          # Run MCP server via tsx
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest (all tests)
pnpm test:watch       # Vitest in watch mode
pnpm build            # Generate schemas + bundle with tsup
pnpm schemas          # Regenerate JSON schemas only
```

### Pre-PR checklist

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm schemas && git diff --exit-code schemas/
```

### Project structure

```
src/
├── adapters/      # Runtime integrations (codex, fake-script)
├── cli/           # Commander-based CLI
├── core/          # Control plane, scheduler, task runner, lifecycle
├── daemon/        # Fastify HTTP daemon
├── db/            # SQLite persistence (better-sqlite3)
├── mcp/           # MCP server (@modelcontextprotocol/sdk)
├── schemas/       # Zod schemas → JSON schema generation
├── storage/       # File-system storage utilities
└── test-support/  # Shared test helpers

test/              # Vitest test files mirroring src/ modules
schemas/           # Generated JSON schema files (committed)
docs/
├── adr/           # Architecture Decision Records
├── agents/        # Agent-specific docs (issue tracker, triage, domain)
├── design/        # Design docs (PRD, architecture, harness, schemas)
└── usage/         # Usage documentation
```

## Resources

- [Architecture Decision Records](docs/adr/) — key design decisions and their rationale
- [Domain Glossary](CONTEXT.md) — precise terminology for sessions, tasks, adapters, and more
- [Subagent Harness Contract](docs/design/subagent-harness.md) — the instruction wrapper given to every subagent
- [V1 Architecture](docs/design/v1-architecture.md) — detailed system architecture
- [Storage Layout](docs/design/storage-layout.md) — OS-native storage paths
