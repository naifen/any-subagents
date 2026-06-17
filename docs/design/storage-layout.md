# Storage Layout

`any-subagents` uses OS-native app directories by default instead of a single
dot-directory such as `~/.any-subagents`.

## macOS

- State, SQLite, artifacts, and durable daemon data:
  `~/Library/Application Support/any-subagents`
- Logs: `~/Library/Logs/any-subagents`
- Cache: `~/Library/Caches/any-subagents`
- Runtime sockets: a private temp/run directory with a short path, to avoid
  Unix socket path-length issues.

## Linux

- Config: `${XDG_CONFIG_HOME:-~/.config}/any-subagents`
- Daemon state, SQLite, event log, and task history:
  `${XDG_STATE_HOME:-~/.local/state}/any-subagents`
- Cache: `${XDG_CACHE_HOME:-~/.cache}/any-subagents`
- Runtime sockets: `${XDG_RUNTIME_DIR}/any-subagents`, with a private `0700`
  fallback runtime directory if `XDG_RUNTIME_DIR` is unset.
- Long-lived exportable user data, if needed:
  `${XDG_DATA_HOME:-~/.local/share}/any-subagents`

## Rationale

The daemon spans projects, so user-level storage is the default. Project-local
storage can be supported as an override for portable demos or tests, but the
runtime should not create project files unless explicitly configured.

Splitting config, state, cache, logs, and runtime sockets follows platform
conventions. It also makes pruning safer: deleting cache or old logs should not
remove the SQLite state database, result envelopes, or artifact registry.

## References

- XDG Base Directory Specification:
  https://specifications.freedesktop.org/basedir-spec/latest/
- Apple File System Programming Guide, Library directory details:
  https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html
- `env-paths` OS-specific path conventions for Node packages:
  https://github.com/sindresorhus/env-paths
