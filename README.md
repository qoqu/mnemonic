# mnemonic

**MCP memory manager** — 3-layer isolation (global / namespace / project), shared across any MCP-compatible agent.

Write memories from Hermes-Agent, query them from OpenClaw, list them from Claude Code — one memory store for all your agents, with built-in privacy between them.

---

## Features

- **11 MCP tools** — add, search, remove, update, list, stats, log, conversation_save/list/get/remove
- **3-layer isolation** — global / namespace / project
- **Dual transport** — stdio (local) **and** HTTP/SSE (cross-device)
- **Admin UI** — built-in web interface at `http://localhost:PORT/`
- **REST API** — HTTP JSON API for non-MCP clients
- **Zero deps** — uses Node 22+ built-in `node:sqlite`, no native compilation

## Quick start

```bash
# grab the code
git clone https://github.com/qoqu/mnemonic.git
cd mnemonic
npm install

# start in stdio mode (default, for MCP hosts)
node src/index.js

# or start in HTTP mode with the admin UI
MNEMONIC_PORT=3456 node src/index.js
# → open http://localhost:3456/
```

## Tools

| Tool | What it does |
|------|-------------|
| `memory_add` | Add a memory. Level auto-detected: project set → `project`, namespace set → `namespace`, neither → `global` |
| `memory_search` | LIKE-based full-text search with scope filtering |
| `memory_remove` | Remove by exact `id` or fuzzy `old_text` |
| `memory_update` | Update content / tags / source by `id` |
| `memory_list` | Browse by scope, sorted by last updated |
| `memory_stats` | Stats: totals by level, 7d activity, tag groups |
| `memory_log_tick` | Lightweight session tick — log what you're doing without polluting the store |
| `conversation_save` | Save full conversation for device migration (not shown in UI) |
| `conversation_list` | List saved conversations (metadata only) |
| `conversation_get` | Retrieve a full conversation by session_id |
| `conversation_remove` | Remove a stored conversation |

## Device migration

Save full conversations to the database so they can be restored on another device.

```bash
# On the old device: save conversation at session end
curl -X POST http://localhost:3456/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"session_id":"my-session-001","project":"myapp","content":"full conversation text...","turn_count":42,"summary":"Refactored the memory store"}'

# On the new device: list available conversations
curl "http://localhost:3456/api/conversations?namespace=reasonix"

# Retrieve a specific conversation
curl "http://localhost:3456/api/conversations/my-session-001"
```

Data is stored in the same SQLite database (`conversations` table) and syncs automatically if the db is on a shared drive. Not shown in the admin UI.

## Auto-tracking with session ticks

The `memory_log_tick` tool lets your agent log what it's working on periodically — building a searchable session timeline visible in the admin UI.

**Recommended usage:** Configure your agent to call `memory_log_tick` every 10-20 turns:

```
Every 10-15 turns, call memory_log_tick with:
  context: brief summary of what you're doing (1-2 sentences)
  status: one of "exploring" / "building" / "fixing" / "reviewing" / "idle" / "done"
  project: current project name (optional)
```

Ticks are stored at `namespace` level and auto-tagged `session-log`, keeping them separate from permanent memories.

```bash
# Via REST API (for non-MCP agents or scripts)
curl -X POST http://localhost:3456/api/log \
  -H "Content-Type: application/json" \
  -d '{"context":"Refactoring the memory store API","status":"building","project":"mnemonic"}'
```

To replay a session's timeline: `memory_search(tags=["session-log"], project="mnemonic")`.

## Layer model

| Level | Visible to | Example |
|-------|-----------|---------|
| `global` | Every agent, every project | "Use `const` over `let`" |
| `namespace` | One agent only | "Hermes — user prefers arrow functions" |
| `project` | One agent's project | "myapp — API key lives in .env" |

Level auto-resolves when set to `"auto"` (default): has `project` → `project`, has `namespace` → `namespace`, else `global`.

## Configure with MCP hosts

### Claude Code / Reasonix / any stdio-based host

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

### Hermes-Agent

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: hermes
```

### OpenClaw

```yaml
# ~/.openclaw/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: openclaw
```

## Cross-device mode (HTTP/SSE)

Run one server on your network, connect from any device.

```bash
# Server (NAS, VPS, or always-on machine)
MNEMONIC_PORT=3456 node src/index.js
```

```yaml
# Client config
mcp_servers:
  mnemonic:
    url: http://192.168.1.100:3456/sse
    transport: streamable-http
```

Health check — see if it's alive and how many SSE clients are connected:

```bash
curl http://localhost:3456/health
# → {"status":"ok","namespace":"default","transports":2}
```

## Admin UI

Open `http://localhost:3456/` in your browser when running in HTTP mode:

- Browse all memories in a table
- Search by keyword
- Filter by level / namespace / project
- Add, edit, delete entries
- View stats at a glance

## REST API (for non-MCP clients)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memories?query=&level=&namespace=&limit=` | Search / list |
| `POST` | `/api/memories` | Add `{content, level?, tags?, source?}` |
| `POST` | `/api/log` | Session tick `{context, status?, project?}` — namespace-level, auto-tagged |
| `PUT` | `/api/memories/:id` | Update `{content?, tags?, source?, level?, project?}` |
| `DELETE` | `/api/memories/:id` | Delete by id |
| `GET` | `/api/stats` | Store statistics |
| `GET` | `/api/conversations?namespace=&project=` | List saved conversations (device migration) |
| `POST` | `/api/conversations` | Save conversation `{session_id, content, project?}` |
| `GET` | `/api/conversations/:session_id` | Get full conversation content |
| `DELETE` | `/api/conversations/:session_id` | Remove saved conversation |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MNEMONIC_NAMESPACE` | `default` | Agent namespace for isolation |
| `MNEMONIC_PROJECT` | `""` | Current project name |
| `MNEMONIC_DB_DIR` | `./data/` | SQLite database directory |
| `MNEMONIC_PORT` | (stdio) | Set to run in HTTP/SSE mode |

**Backward compat**: `REASONIX_MEMORY_*` fallbacks are supported during migration.

## Storage

- SQLite, single file: `data/memories.db`
- Created automatically on first run
- Full-text search via LIKE (works in all SQLite builds without FTS extensions)
- WAL mode enabled for concurrent reads
- Move it to a NAS / sync folder for cross-device setups

> **⚠️ Synced database — run one instance at a time**
>
> If you put `memories.db` on a cloud sync folder (OneDrive / iCloud / NAS sync):
> - Run mnemonic on **one machine at a time** only
> - Stop the server before switching to another machine
> - The sync client will propagate the latest data automatically
> - Reason: SQLite + sync = safe when one writer; risky when two writers race

## Requirements

- **Node.js 22+** (uses built-in `node:sqlite`, no native compilation needed)
- npm (for `@modelcontextprotocol/sdk`)

## Test

```bash
node src/test.js
```

## Project structure

```
mnemonic/
├── src/
│   ├── index.js      # MCP Server + HTTP Server + REST API + Admin UI
│   ├── admin.html    # Web admin interface (single-file, no deps)
│   ├── db.js         # SQLite setup and schema
│   ├── store.js      # CRUD operations with 3-layer isolation
│   ├── tools.js      # MCP tool definitions and handlers
│   └── test.js       # End-to-end test
├── README.md
├── package.json
├── LICENSE
└── .gitignore
```

## License

MIT
