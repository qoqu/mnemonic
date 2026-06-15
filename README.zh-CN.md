# mnemonic

**MCP 全局记忆管理器** — 三层隔离（global / namespace / project），跨 Agent 共享记忆库。

Hermes 写的记忆，OpenClaw 能搜到，Claude Code 也能读到——但各自的私有笔记互不干扰。

---

## 特性

- **15 个 MCP 工具** — 增删改查 + 渐进搜索 + 自动日志 + 知识库导出 + 对话导入 + 设备迁移
- **三层隔离** — global / namespace / project
- **双传输模式** — stdio（本地）+ HTTP/SSE（跨设备）
- **管理界面** — 浏览器打开 `http://localhost:PORT/`
- **REST API** — 非 MCP 客户端也能用
- **零编译** — 使用 Node 22+ 内置 `node:sqlite`，无需 C++ 编译

## 快速开始

```bash
git clone https://github.com/qoqu/mnemonic.git
cd mnemonic
npm install

# stdio 模式（MCP 主机使用）
node src/index.js

# HTTP 模式（带管理界面）
MNEMONIC_PORT=3456 node src/index.js
# → 浏览器打开 http://localhost:3456/
```

## 工具

| 工具 | 作用 |
|------|------|
| `memory_add` | 添加记忆。**自动捕捉**：Agent 在重要操作后自动保存，支持重要度 low/normal/high/critical |
| `memory_search` | 渐进式 3 层搜索：`mode=index`（紧凑）或 `mode=full`（完整），支持 `budget=N` token 预算 |
| `memory_preview` | Layer 2 — 按 ID 列表取多条完整内容 |
| `memory_get` | Layer 3 — 按 ID 取单条完整内容 |
| `memory_remove` | 按 ID 或内容模糊匹配删除 |
| `memory_update` | 按 ID 更新内容/标签/来源/重要度 |
| `memory_list` | 按作用域浏览，支持 `budget=N` token 预算 |
| `memory_stats` | 统计：各层级数量、7 天活跃度、标签分组 |
| `memory_log_tick` | 轻量会话日志（自动 importance=low） |
| `conversation_save` | 保存全量对话（设备迁移） |
| `conversation_list` | 列出已保存的对话（仅元数据） |
| `conversation_get` | 按 session_id 取全量对话内容 |
| `conversation_remove` | 删除已保存的对话 |
| `conversation_import` | 批量导入 session 文件到对话表（覆盖旧数据） |

## 渐进式搜索（token 感知）

3 层搜索，Agent 调用时省 token：

```
Layer 1: memory_search(query, mode="index", budget=500)
  → 紧凑索引（id + 前 120 字摘要）。~50 tokens/条
  → 超出 budget 自动截断

Layer 2: memory_preview(ids=["mem_abc", "mem_def"])
  → 选中几条展开完整内容

Layer 3: memory_get(id="mem_abc")
  → 取单条完整内容
```

管理界面搜索时自动使用紧凑模式，点 👁 展开完整内容。

```bash
curl "http://localhost:3457/api/memories?query=架构&mode=index"
curl "http://localhost:3457/api/memories-preview?ids=mem_abc,mem_def"
curl "http://localhost:3457/api/memories/mem_abc"
```

## 设备迁移

全量对话保存在数据库中，换设备后可以恢复上下文。

```bash
# 旧设备上保存对话
curl -X POST http://localhost:3456/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"session_id":"my-session-001","project":"myapp","content":"完整对话内容...","turn_count":42,"summary":"重构了记忆存储"}}'

# 新设备上列出已保存的对话
curl "http://localhost:3456/api/conversations?namespace=reasonix"

# 获取某次对话全文
curl "http://localhost:3456/api/conversations/my-session-001"
```

数据存在同一 SQLite 数据库的 `conversations` 表中，如果数据库在同步盘上则自动同步。不在管理界面展示。

## 自动会话日志（Tick）

`memory_log_tick` 工具让 Agent 自动记录当前工作状态，生成一个按时间轴排列的活动记录，在管理界面中勾选 "Timeline" 即可看到。

**建议配置：** 让你的 Agent 每 10-15 轮对话调一次 `memory_log_tick`：

```
每 10-15 轮调一次 memory_log_tick，参数：
  context: 当前在做什么（1-2 句话）
  status: "exploring" / "building" / "fixing" / "reviewing" / "idle" / "done"
  project: 项目名（可选）
```

Tick 存在 namespace 级，自动打 `session-log` 标签，跟正式记忆互不干扰。

```bash
# 直接调 REST API
curl -X POST http://localhost:3456/api/log \
  -H "Content-Type: application/json" \
  -d '{"context":"重构记忆存储 API","status":"building","project":"mnemonic"}'
```

查看某个会话的时间线：`memory_search(tags=["session-log"], project="mnemonic")`

## 重要度

每条记忆有重要度标记。Agent 会在重要操作后自动保存：

| 级别 | 使用场景 | 谁触发 |
|------|---------|--------|
| `critical` | 安全问题、破坏性变更、数据丢失 | Agent 自动识别 |
| `high` | **你说"记住这个"** | 你手动 |
| `normal` | 日常决策、设计选择、修复 | Agent 自动捕捉 |
| `low` | 会话 Tick、临时记录 | `memory_log_tick` 专用 |

Agent 在文件编辑、决策、修复后自动调 `memory_add(importance="normal")`，无需每次手动说。

## 知识库归档（kb-integration 分支）

`export_to_kb` 做两件事：
1. 导出完整内容为 `.md` 文件到 Obsidian 收件箱
2. **在 mnemonic 中创建骨架索引**（打 `kb-archive` 标签）供 Agent 搜索

Agent 可以搜索整个知识库归档：

```
memory_search(tags=["kb-archive"], project="mnemonic")
→ 返回结构化骨架（type/topics/entities）
→ source 字段指向 .md 文件路径
→ 感兴趣的可以去 Obsidian 读全文
```

## 三层隔离
|------|--------|------|
| `global` | 所有 Agent 所有项目 | "用 const 不用 let" |
| `namespace` | 仅该 Agent | "Hermes — 用户偏好箭头函数" |
| `project` | 仅该 Agent 的某个项目 | "myapp — 数据库配置" |

level 设为 `"auto"`（默认）自动判断：有 project → project 级，有 namespace → namespace 级，都没有 → global 级。

## 配置 MCP 主机

### Claude Code / Reasonix

```json
{
  "mcpServers": {
    "mnemonic": {
      "command": "node",
      "args": ["/path/to/mnemonic/src/index.js"],
      "env": { "MNEMONIC_NAMESPACE": "claude-code" }
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

## 跨设备模式（HTTP/SSE）

一台机器跑服务，多台设备共享记忆库。

```bash
# 服务端（NAS、VPS 或常开机设备）
MNEMONIC_PORT=3456 node src/index.js
```

```yaml
# 客户端配置
mcp_servers:
  mnemonic:
    url: http://192.168.1.100:3456/sse
    transport: streamable-http
```

健康检查：

```bash
curl http://localhost:3456/health
# → {"status":"ok","namespace":"default","transports":2}
```

跨设备场景建议将数据库文件放在网络存储上，通过 `MNEMONIC_DB_DIR` 指定。

## 管理界面

HTTP 模式下打开 `http://localhost:3456/`：

- **记忆表格** — 默认显示全部内容
- **搜索** — 自动切换为紧凑模式（前 120 字摘要），点 **👁** 展开全文
- **筛选** — 按 level / namespace / project
- **Timeline** — 勾选后右侧显示会话活动时间轴
- **新增、编辑、删除** — 弹窗操作
- **统计栏** — Total / Global / Namespace / Project / Last 7 days
- **健康卡** — schema 版本（`v4`）、DB 完整性（`✓`/`✗`）、队列状态（`✓`/`⚠`）

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/memories?query=&level=&namespace=&limit=` | 搜索/列表 |
| `POST` | `/api/memories` | 添加 `{content, level?, tags?, source?}` |
| `POST` | `/api/log` | 会话日志 `{context, status?, project?}` — namespace 级，自动标签 |
| `PUT` | `/api/memories/:id` | 更新 `{content?, tags?, source?, level?, project?}` |
| `DELETE` | `/api/memories/:id` | 删除 |
| `GET` | `/api/memories/:id` | 按 ID 取单条完整内容（Layer 3） |
| `GET` | `/api/memories-preview?ids=a,b,c` | 按 ID 批量预览（Layer 2） |
| `GET` | `/api/health` | 详细健康报告（schema 版本/DB 完整性/队列状态） |
| `GET` | `/api/stats` | 统计 |
| `GET` | `/api/conversations?namespace=&project=` | 列出已保存对话（设备迁移） |
| `POST` | `/api/conversations` | 保存对话 `{session_id, content, project?}` |
| `GET` | `/api/conversations/:session_id` | 获取完整对话内容 |
| `DELETE` | `/api/conversations/:session_id` | 删除已保存对话 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MNEMONIC_NAMESPACE` | `default` | Agent 命名空间 |
| `MNEMONIC_PROJECT` | `""` | 当前项目名 |
| `MNEMONIC_DB_DIR` | `./data/` | 数据库目录 |
| `MNEMONIC_PORT` | (stdio) | 设为端口号启用 HTTP/SSE 模式 |

## 存储

- SQLite 单文件 `data/memories.db`
- 首次运行自动创建
- 全文搜索使用 LIKE（兼容所有 Node 版本的 SQLite）
- WAL 模式，支持并发读取
- 可迁到 NAS 同步目录做跨设备共享

> **⚠️ 同步盘数据库 — 一次只开一台**
>
> 如果把 `memories.db` 放在云同步文件夹（OneDrive / iCloud / NAS 同步盘）：
> - **同一时刻只在一台机器上运行 mnemonic**
> - 切到另一台前先停掉当前的服务
> - 同步客户端会自动把最新数据同步到下一台
> - 原因：SQLite + 同步盘 = 单写安全，双写冲突

## 环境要求

- **Node.js 22+**（使用内置 `node:sqlite`，零原生编译）
- npm

## 运行测试

```bash
node src/test.js
```

## 项目结构

```
mnemonic/
├── src/
│   ├── index.js      # MCP Server + HTTP Server + REST API + Admin UI
│   ├── admin.html    # 管理界面（单文件，零依赖）
│   ├── db.js         # SQLite 初始化与建表
│   ├── store.js      # 三层隔离 CRUD
│   ├── tools.js      # MCP 工具定义
│   └── test.js       # 端到端测试
├── README.md
├── README.zh-CN.md
├── package.json
├── LICENSE
└── .gitignore
```

## 许可

MIT
