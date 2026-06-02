# mnemonic

**MCP 全局记忆管理器** — 三层隔离（global / namespace / project），跨 Agent 共享记忆库。

Hermes-Agent 写入的记忆，OpenClaw、Claude Code 或其他 MCP 工具都能读到——同时各自的私有笔记互不干扰。

---

## 工具

| 工具 | 作用 |
|------|------|
| `memory_add` | 添加一条记忆。level 自动判断：有 project → `project`，有 namespace → `namespace`，都没有 → `global` |
| `memory_search` | FTS5 全文搜索，支持三层隔离过滤 |
| `memory_remove` | 按精确 `id` 或模糊 `old_text` 删除 |
| `memory_update` | 按 `id` 更新内容 / 标签 / 来源 |
| `memory_list` | 按 scope 浏览，按最近更新排序 |
| `memory_stats` | 统计：总数、各层级分布、近7天新增、标签分组 |

## 三层隔离

| 层级 | 范围 | 场景 |
|------|------|------|
| `global` | 所有 Agent 所有项目 | "TypeScript 用 `const` 而非 `let`" |
| `namespace` | 仅该 Agent | "Hermes —— 用户偏好箭头函数" |
| `project` | 该 Agent 下的某项目 | "api-docs —— API Key 在 .env 里" |

## 快速开始

```bash
# 安装
npm install

# 启动（默认 namespace=default）
node src/index.js

# 指定 agent
MNEMONIC_NAMESPACE=hermes node src/index.js

# 同时指定 agent 和项目
MNEMONIC_NAMESPACE=hermes MNEMONIC_PROJECT=myapp node src/index.js
```

## Hermes-Agent 配置

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: hermes
      MNEMONIC_PROJECT: ""

# 可选：设默认项目
reasonix_memory:
  project: "my-project"
```

## OpenClaw 配置

```yaml
# ~/.openclaw/config.yaml
mcp_servers:
  mnemonic:
    command: node /path/to/mnemonic/src/index.js
    env:
      MNEMONIC_NAMESPACE: openclaw
      MNEMONIC_PROJECT: ""
```

## Claude Code / 任何 MCP 客户端

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

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MNEMONIC_NAMESPACE` | `default` | Agent 命名空间。每个 agent 有自己的 `namespace` 级隔离 |
| `MNEMONIC_PROJECT` | `""` | 当前项目名。启用 `project` 级隔离 |
| `MNEMONIC_DB_DIR` | `./data/` | SQLite 数据库存放目录 |

**向后兼容**：`REASONIX_MEMORY_*` 环境变量仍被支持，方便迁移。

## 存储

- SQLite + FTS5，单文件 `data/memories.db`
- 首次运行自动创建，无需手动初始化
- 可通过 `MNEMONIC_DB_DIR` 修改数据库位置

## 运行测试

```bash
node src/test.js
```

## 许可

MIT
