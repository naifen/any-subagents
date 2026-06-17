# any-subagents Context

## Language

### Terms

- Orchestrator: the root LLM agent that decomposes work, submits task groups,
  updates the session brief, chooses winners, and decides follow-up actions.
- Subagent: a real LLM agent runtime launched by `any-subagents` to execute one
  delegated task.
- Control Plane: the local daemon that owns durable state, scheduling,
  supervision, worktree isolation, artifacts, events, metrics, and aggregation.
- Session: a long-lived teamwork container with a stable base ref, shared brief,
  task groups, budgets, events, logs, artifacts, and merge attempts.
- Session Brief: the compact orchestrator-maintained shared state for a session:
  goals, constraints, decisions so far, accepted findings, rejected paths, and
  open questions.
- Task Group: a semantic phase and scheduling batch inside a session.
- Task: one logical delegated unit of work. A task may have multiple attempts.
- Task Attempt: one concrete process execution for a task. Attempts own process
  metadata, logs, worktree, result files, diffs, verification output, and
  evidence artifacts.
- Adapter: the runtime-specific integration that launches and supervises a
  subagent, such as the built-in Codex adapter.
- Profile: a named adapter configuration containing defaults and allowlists for
  model, reasoning level, command template, sandbox settings, permissions,
  budgets, and concurrency.
- Artifact: a typed output record for text, code, diffs, logs, evidence,
  benchmarks, coverage, screenshots, recordings, or arbitrary files.
- Harness Directory: the `.any-subagents/` directory written into a task
  worktree with the task envelope, brief snapshot, instructions, schemas,
  result files, and staged artifacts.

### Avoid

- Avoid `workflow` for the v1 runtime model. Use `session` and `task group`
  unless discussing future DAG/workflow support.
- Avoid `job` for delegated work. Use `task` for logical work and `task attempt`
  for a concrete run.
- Avoid `worker` for LLM runtimes. Use `subagent`.
- Avoid `mission`, `team`, or `agent swarm` in technical docs. Use the precise
  nouns above.
- Avoid saying the runtime "plans" work in v1. The orchestrator decomposes and
  the control plane schedules/supervises.

## Relationships

- One orchestrator creates one or more sessions.
- One session has one session brief and zero or more task groups.
- One task group belongs to one session and contains independent tasks for a
  semantic phase.
- One task belongs to one task group and has one or more task attempts.
- One task attempt launches one subagent process through one adapter/profile.
- Artifacts can be scoped to attempts, tasks, task groups, or sessions.
- Events are append-only and can reference sessions, task groups, tasks,
  attempts, and artifacts.
- The orchestrator may accept proposed brief updates from subagent results, but
  only the orchestrator mutates the session brief.

## Example Dialogue

Developer: "Let's create a workflow for ten workers."

Domain Expert: "In this project, call that a session with one task group and ten
subagent tasks. The control plane schedules them; it does not plan the work."

Developer: "The job failed and retried."

Domain Expert: "Say the task had a failed task attempt and a later retry attempt.
The task identity stayed stable while each attempt kept its own worktree and
logs."

Developer: "The subagent updated shared memory."

Domain Expert: "The subagent proposed session brief updates in its result. The
orchestrator accepted or rejected those updates."

## Flagged Ambiguities

- External adapter protocol: v1 keeps Codex built in while shaping the boundary
  for future external adapter processes.
- Runtime DAG support: v1 represents dependencies through later task groups,
  not task-level dependencies inside a group.
- Mid-task elicitation: v1 uses terminal `blocked` results; runtime-mediated
  `input_required` is deferred.
- GUI/Manager surface: v1 exposes MCP and CLI only; a rich visual manager is
  deferred.
