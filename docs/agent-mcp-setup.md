# Agent MCP setup (use Cursor as an example)

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

Optional local configuration lives at `~/.config/any-subagents/config.toml` or `./any-subagents.toml`.
