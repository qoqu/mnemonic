# mnemonic

**MCP memory manager** — 3-layer isolation (global / namespace / project), shared across any MCP-compatible agent.

Memories written by Hermes-Agent are visible to OpenClaw, Claude Code, or any other tool that speaks MCP — without leaking private notes between agents.

---

## Tools

| Tool | Description |
|------|-------------|
| `memory_add` | Add a memory entry. Level auto-detected: project → `project`, namespace → `namespace`, neither → `global` |
| `memory_search` | FTS5 full-text search with scope filtering |
| `memory_remove` | Remove by exact `id` or fuzzy `old_text` |
| `memory_update` | Update content / tags / source by `id` |
| `memory_list` | Browse memories by scope, sorted by last updated |
| `memory_stats` | Stats: total, by level, recent 7d, top tag groups |

## Layer model

| Level | Scope | Example |
|-------|-------|---------|
| `global` | Every agent, every project | "Always use `const` over `let`" |
| `namespace` | One agent only | "Hermes — user prefers arrow functions" |
| `project` | One agent's project | "api-docs — API key lives in .env" |

## Quick start

```bash
# install
npm install

# start (default namespace=default)
node src/index.js

# start with a namespace
MNEMONIC_NAMESPACE=hermes node src/index.js

# start with namespace + project
MNEMONIC_NAMESPACE=hermes MNEMONIC_PROJECT=myapp node src/index.js
```

## Hermes-Agent

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: hermes
      MNEMONIC_PROJECT: ""

# optionally set a default project
reasonix_memory:
  project: "my-project"
```

## OpenClaw

```yaml
# ~/.openclaw/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: openclaw
      MNEMONIC_PROJECT: ""
```

## Claude Code / any MCP host

```json
{
  "mcpServers": {
    "mnemonic": {
      "command": "node",
      "args": ["/path/to/mnemonic/src/index.js"],
      "env": {
        "MNEMONIC_NAMESPACE": "claude-code"
      }
    }
  }
}
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMONIC_NAMESPACE` | `default` | Agent namespace. Each agent gets its own `namespace`-level isolation |
| `MNEMONIC_PROJECT` | `""` | Current project name. Sets `project`-level isolation |
| `MNEMONIC_DB_DIR` | `./data/` | Directory for the SQLite database file |

**Backward compat**: `REASONIX_MEMORY_*` fallbacks are still supported during migration.

## Storage

- SQLite + FTS5, single file: `data/memories.db`
- Created automatically on first run
- Database location can be changed via `MNEMONIC_DB_DIR`

## Test

```bash
node src/test.js
```

## License

MIT
