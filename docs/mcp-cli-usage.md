# How to use MCP and CLI

## Agent MCP setup (use Cursor as an example)

Add `any-subagents` to Cursor as a stdio MCP server:

```json
{
  "mcpServers": {
    "any-subagents": {
      "command": "any-subagents-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

If the binary is not on your `PATH`, use the absolute path to the built entry point:

```json
{
  "mcpServers": {
    "any-subagents": {
      "command": "/opt/homebrew/bin/node", # use the node which better-sqlite3 is built with
      "args": ["/absolute/path/to/any-subagents/dist/mcp.js"]
    }
  }
}
```

All options come from the Zod schema in `src/config/schema.ts`. They load from:

1. `~/.config/any-subagents/config.toml`
2. `./any-subagents.toml` (merged on top if present)

Missing files → defaults apply.

---

## Top-level keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `schema_version` | `"1"` | `"1"` | Config format version |
| `max_concurrency` | integer | — | **Deprecated.** Folded into `concurrency.global` |
| `capacity_preemption_policy` | `"stop_starting"` \| `"cancel_running"` | `"stop_starting"` | When at capacity: stop dequeuing vs cancel a lower-priority running task |
| `budget_exhaustion_policy` | same enum | — | **Deprecated.** Alias for `capacity_preemption_policy` |
| `skill_paths` | string[] | `[]` | Directories mounted read-only into task worktrees (`.any-subagents/skills/`) |
| `skill_mount` | `"symlink"` \| `"copy"` | `"symlink"` | How skill dirs are mounted |
| `skill_path_allowlist` | string[] | `[]` | If non-empty, only skill paths under these prefixes are mounted |
| `redactions` | string[] | `[]` | Extra regex/string patterns for best-effort secret redaction in harness/logs |
| `path_redaction` | boolean | `false` | Redact local filesystem paths in log previews and exports |
| `security_preset` | `"strict"` \| `"default"` \| `"permissive"` | `"default"` | Baseline security overlay applied to all profiles before explicit profile keys (see [Security presets](#security-presets)) |

---

## `[concurrency]`

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `global` | integer | `4` | Max concurrent running tasks overall |
| `group` | integer | — | Max concurrent tasks per task group |
| `provider.<adapter>` | integer | — | Max concurrent tasks per adapter (e.g. `codex`, `fake`) |
| `repo.<path>` | integer | — | Max concurrent tasks per repo path |

Example:

```toml
[concurrency]
global = 4
group = 2

[concurrency.provider]
codex = 2

[concurrency.repo]
"/Users/jg/Repos/my-app" = 1
```

---

## `[export]`

Controls session bundle export (`export_session` / CLI `session export`).

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `include_logs` | boolean | `true` | Include log previews in export |
| `include_artifacts` | boolean | `true` | Include `artifacts.json` |
| `include_markdown` | boolean | `true` | Include `summary.md` |

---

## `[profiles.<adapter>.<profile>]`

Nested map: adapter name (`fake`, `codex`, …) → profile name (`default`, …).

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `concurrency` | integer | global limit | Max concurrent tasks for this adapter/profile |
| `timeout_ms` | integer | `30000` in effective-config | Profile timeout (see note below) |
| `allowed_models` | string[] | — | Allowlist; out-of-list requests fail submission unless task `allow_fallback: true` |
| `default_model` | string | — | Default/fallback model |
| `allowed_reasoning_levels` | string[] | — | Allowlist; out-of-list requests fail submission unless task `allow_fallback: true` |
| `default_reasoning_level` | string | — | Default/fallback reasoning level |
| `network_policy` | `"allow"` \| `"deny"` \| `"restricted"` | — | Stored on attempt; policy metadata |
| `package_install_policy` | `"allow"` \| `"deny"` \| `"ask"` | — | Stored on attempt; policy metadata |
| `sandbox` | table (free-form) | — | Sandbox config merged onto attempts |
| `permissions` | table (free-form) | — | Permissions merged onto attempts |

Example:

```toml
[profiles.codex.default]
concurrency = 2
timeout_ms = 60_000
allowed_models = ["gpt-5"]
default_model = "gpt-5"
allowed_reasoning_levels = ["medium", "high"]
default_reasoning_level = "high"
network_policy = "restricted"
package_install_policy = "ask"

[profiles.codex.default.sandbox]
mode = "restricted"

[profiles.codex.default.permissions]
write = true
```

Built-in adapters without custom profiles still get a `default` profile from the adapter registry (empty `{}`).

---

## Security presets

Top-level `security_preset` applies a baseline overlay to every profile before
explicit profile keys merge (explicit profile fields win).

| Preset | `network_policy` | `package_install_policy` | `permissions` | `sandbox.mode` |
| --- | --- | --- | --- | --- |
| `strict` | `deny` | `deny` | `{ write: false, network: false }` | `strict` |
| `default` | `restricted` | `ask` | *(no overlay)* | `restricted` |
| `permissive` | `allow` | `allow` | `{ write: true, network: true }` | `workspace-write` |

Example:

```toml
security_preset = "strict"

[profiles.codex.default]
network_policy = "allow"  # overrides strict preset for this profile
```

Inspect resolved values with `get_effective_config` (`security.preset` and
`security.preset_expansion`).

---

## Full example skeleton

```toml
schema_version = "1"

skill_paths = ["/Users/jg/.agents/skills"]
skill_mount = "symlink"
skill_path_allowlist = ["/Users/jg/.agents"]
redactions = ["sk-[A-Za-z0-9]+"]
path_redaction = false

capacity_preemption_policy = "stop_starting"

[concurrency]
global = 4
group = 2

[concurrency.provider]
codex = 2

[export]
include_logs = true
include_artifacts = true
include_markdown = true

[profiles.codex.default]
concurrency = 2
timeout_ms = 30_000
default_model = "gpt-5"
default_reasoning_level = "high"
```

---

## Not in `config.toml`

These are runtime paths / derived config (from `effective-config`), not user-editable in TOML:

- `state_dir`, `db_path`, `logs_dir`, `artifacts_dir`, `worktree_root`, `runtime_dir` — under `~/.local/state/any-subagents/` (or platform equivalent)
- Adapter availability/health — probed at runtime
- Adapter capabilities (`supports_model_selection`, etc.) — from adapter registry

Inspect resolved config:

```bash
any-subagents effective-config --json
```

---

## Wiring notes

- **`capacity_preemption_policy = "cancel_running"`** — scheduler may cancel a lower-priority running task to make room for a higher-priority queued one.
- **`path_redaction` + `redactions`** — applied in harness files, log previews, and reflected in `get_effective_config`; not a security boundary.
- **Profile `timeout_ms`** — appears in effective config (`30_000` default) but is **not** auto-injected into task envelopes today; task timeout still comes from per-task `timeout_ms` at submission unless you set it there.

Source of truth: `src/config/schema.ts`, loaded by `src/config/load.ts`, normalized by `src/config/normalize.ts`.

To use the Codex adapter with both the CLI and the MCP server, you must structure your request under the Session and Task Group domain model of  any-subagents .

Here is the exact analysis of the command structures, schemas, and prompt generation logic in the codebase:
──────
## 1. Using the Codex Adapter via CLI

To run a task with Codex using the command-line interface:

### Step 1: Create a Session

You must first initialize a session for your git repository and a base branch/ref.

  any-subagents session create \
    --repo "/absolute/path/to/your/git-repo" \
    --base-ref "main" \
    --goal "Integrate database cache module" \
    --json

This command returns a JSON object containing a  session_id  (e.g.,  sess_12345 ) and the initial  brief_revision  (which starts at  0 ).

### Step 2: Submit a Task Group with Codex

Submit a task group by passing a serialized JSON payload containing the task details to the  task-group submit  command:

  any-subagents task-group submit --json-input '{
    "session_id": "sess_12345",
    "title": "Phase 1: Diagnosis",
    "expected_brief_revision": 0,
    "tasks": [
      {
        "mode": "diagnose",
        "goal": "Find out why connection pool runs out of connections under load",
        "adapter": "codex",
        "profile": "default",
        "success_criteria": [
          "Locate connection leak in database handler",
          "Document step-by-step reproduction"
        ],
        "model": "gpt-4o",
        "reasoning_level": "medium"
      }
    ]
  }' --json
  ──────
## 2. Using the Codex Adapter via MCP (Model Context Protocol)

When interacting programmatically with the MCP server (e.g., via Cursor or other hosts), you use the following tool schemas:

### Step 1: Create a Session

Call the  create_session  tool with the parameters matching contracts.ts:

• Tool Name:  create_session
• Arguments:
  {
    "repo": "/absolute/path/to/your/git-repo",
    "base_ref": "main",
    "brief": {
      "goal": "Integrate database cache module",
      "constraints": ["Do not write to third-party APIs"]
    }
  }


### Step 2: Submit a Task Group using Codex

Call the  submit_task_group  tool with the parameters matching contracts.ts:

• Tool Name:  submit_task_group
• Arguments:
  {
    "session_id": "sess_12345",
    "title": "Phase 1: Diagnosis",
    "expected_brief_revision": 0,
    "tasks": [
      {
        "mode": "diagnose",
        "goal": "Find out why connection pool runs out of connections under load",
        "adapter": "codex",
        "profile": "default",
        "success_criteria": [
          "Locate connection leak in database handler",
          "Document step-by-step reproduction"
        ],
        "model": "gpt-4o",
        "reasoning_level": "medium"
      }
    ]
  }

──────
## 3. How the Codex Adapter Synthesizes the Prompt

When the task runs, the control plane retrieves the task and the session brief and renders a single consolidated prompt using codex.ts:

  export const renderCodexPrompt = (envelope: TaskEnvelope, brief: SessionBrief): string => {
    const sections = [
      `Goal: ${envelope.goal}`,
      renderSection("Success criteria", envelope.success_criteria),
      envelope.constraints ? renderSection("Task constraints", envelope.constraints) : undefined,
      envelope.scope
        ? [
            renderSection("Scope paths", envelope.scope.paths),
            envelope.scope.notes ? `Scope notes: ${envelope.scope.notes}` : undefined
          ]
            .filter(Boolean)
            .join("\n\n")
        : undefined,
      brief.goal ? `Session goal: ${brief.goal}` : undefined,
      renderSection("Session constraints", brief.constraints),
      renderSection("Decisions", brief.decisions),
      renderSection("Accepted findings", brief.accepted_findings),
      renderSection("Rejected paths", brief.rejected_paths),
      renderSection("Open questions", brief.open_questions)
    ].filter(Boolean);

    return sections.join("\n\n");
  };

This renders a highly structured prompt string that contains all active context for the subagent, looking similar to this:

  Goal: Find out why connection pool runs out of connections under load

  Success criteria:
  - Locate connection leak in database handler
  - Document step-by-step reproduction

  Session goal: Integrate database cache module

  Session constraints:
  - Do not write to third-party APIs
  ──────
## 4. Under the Hood CLI Invocation for Codex

The control plane constructs the final CLI arguments using codex.ts and spawns the external  codex  process inside the isolated task worktree:

  codex exec \
    -m "gpt-4o" \
    -c "model_reasoning_effort=medium" \
    --full-auto \
    -C "/path/to/worktree-for-this-task-attempt" \
    --skip-git-repo-check \
    --json \
    --ephemeral \
    "<rendered_prompt_contents>"

•  -m  flag: Included if a  model  is requested.
•  -c  flag: Included if a  reasoning_level  is requested. Neutral reasoning levels are mapped to Codex-supported ones (e.g., mapping  max  →  xhigh ).
•  --json  and  --ephemeral : Instruct the Codex CLI to run non-interactively and stream JSON Lines events to standard output, which the control plane's
task-runner.ts parses and wraps into a validated  result.json  contract automatically.
