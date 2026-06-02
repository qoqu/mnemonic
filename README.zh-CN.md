# mnemonic

**MCP 全局记忆管理器** — 三层隔离（global / namespace / project），跨 Agent 共享记忆库。

Hermes 写的记忆，OpenClaw 能搜到，Claude Code 也能读到——但各自的私有笔记互不干扰。

---

## 特性

- **6 个 MCP 工具** — 增删改查统统计
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
| `memory_add` | 添加记忆。level 自动判断 |
| `memory_search` | LIKE 全文搜索 + 三层隔离过滤 |
| `memory_remove` | 按 ID 或内容模糊匹配删除 |
| `memory_update` | 按 ID 更新内容/标签/来源 |
| `memory_list` | 按作用域浏览，按最近更新排序 |
| `memory_stats` | 统计：各层级数量、7 天活跃度、标签分组 |

## 三层隔离

| 层级 | 谁可见 | 场景 |
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

- 表格浏览所有记忆
- 关键词搜索
- 按 level / namespace / project 筛选
- 新增、编辑、删除
- 统计面板

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/memories?query=&level=&namespace=&limit=` | 搜索/列表 |
| `POST` | `/api/memories` | 添加 `{content, level?, tags?, source?}` |
| `PUT` | `/api/memories/:id` | 更新 `{content?, tags?, source?}` |
| `DELETE` | `/api/memories/:id` | 删除 |
| `GET` | `/api/stats` | 统计 |

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
