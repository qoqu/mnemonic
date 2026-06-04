# mnemonic

**MCP memory manager** — 3-layer isolation (global / namespace / project), shared across any MCP-compatible agent.

Write memories from Hermes-Agent, query them from OpenClaw, list them from Claude Code — one memory store for all your agents, with built-in privacy between them.

---

## Features

- **15 MCP tools** — add, search, remove, update, list, stats, log, preview, get, conversation tools, progressive search with token budget
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
| `memory_search` | Progressive 3-layer search: `mode=index` (compact) or `mode=full` (verbose). Add `budget=N` for token limit |
| `memory_preview` | Layer 2 — get selected memories by IDs with full content |
| `memory_get` | Layer 3 — get a single memory by ID |
| `memory_remove` | Remove by exact `id` or fuzzy `old_text` |
| `memory_update` | Update content / tags / source / level / project by `id` |
| `memory_list` | Browse by scope. Supports `budget=N` for token limit |
| `memory_stats` | Stats: totals by level, 7d activity, tag groups |
| `memory_log_tick` | Lightweight session tick — log what you're doing without polluting the store |
| `conversation_save` | Save full conversation for device migration (not shown in UI) |
| `conversation_list` | List saved conversations (metadata only) |
| `conversation_get` | Retrieve a full conversation by session_id |
| `conversation_remove` | Remove a stored conversation |

## Progressive search (token-aware)

3 search layers to minimize token usage — Agent-friendly, cost-aware.

```
Layer 1: memory_search(query, mode="index", budget=500)
  → Compact index (id + ~120 chars snippet). ~50 tokens/item.
  → Truncated by token budget if specified.

Layer 2: memory_preview(ids=["mem_abc", "mem_def"])
  → Full content for selected items. Only pay for what you open.

Layer 3: memory_get(id="mem_abc")
  → Single item, full content.
```

Admin UI auto-switches to compact mode when searching — click 👁 to expand.

```bash
curl "http://localhost:3457/api/memories?query=architecture&mode=index"
curl "http://localhost:3457/api/memories-preview?ids=mem_abc,mem_def"
curl "http://localhost:3457/api/memories/mem_abc"
```

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

## Importance levels

Every memory has an importance level. Agent auto-saves after significant actions:

| Level | When | Who saves |
|-------|------|-----------|
| `critical` | Security issues, breaking changes, data loss | Agent auto-detects |
| `high` | Manual "remember this" by user | **You say "记住这个"** |
| `normal` | Useful info, design decisions, fixes | Agent auto-captures |
| `low` | Session ticks, transient notes | `memory_log_tick` only |

Auto-capture: Agent calls `memory_add(importance="normal")` automatically after file edits, bug fixes, decisions, config changes. No need to say "remember this" for routine work.

## Layer model
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

- **Memories table** — browse all entries, full content by default
- **Search** — auto-switches to compact preview (120 chars), click **👁** to expand full content
- **Filter** — by level (global/namespace/project), namespace, or project name
- **Timeline** — checkbox toggles a right-panel session activity timeline
- **Add / edit / delete** — inline modal forms
- **Stats bar** — Total / Global / Namespace / Project / Last 7 days counts
- **Health cards** — schema version (`v4`), DB integrity (`✓`/`✗`), Queue status (`✓`/`⚠`)

## REST API (for non-MCP clients)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/memories?query=&level=&namespace=&limit=&mode=index` | Search (mode=index for compact, mode=full for verbose) |
| `GET` | `/api/memories/:id` | Get single memory by ID (Layer 3) |
| `GET` | `/api/memories-preview?ids=a,b,c` | Preview by IDs (Layer 2) |
| `POST` | `/api/memories` | Add `{content, level?, tags?, source?}` |
| `POST` | `/api/log` | Session tick `{context, status?, project?}` — namespace-level, auto-tagged |
| `PUT` | `/api/memories/:id` | Update `{content?, tags?, source?, level?, project?}` |
| `DELETE` | `/api/memories/:id` | Delete by id |
| `GET` | `/api/stats` | Store statistics |
| `GET` | `/api/health` | Detailed health report (schema version, DB integrity, queue status) |
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
