# mnemonic + Obsidian Vault 知识库集成方案

> 适用于 `kb-integration` 分支
> 需要你已有一个基于 sort.js 分拣的 Obsidian 知识库

---

## 架构总览

```
┌──────────────────────────────────────────────┐
│                mnemonic MCP                     │
│  全局记忆管理器 · 三层隔离 · 跨会话跨设备持久化    │
│                                                │
│  memory_add / memory_search / memory_log_tick  │
│  export_to_kb (summary / full / both)          │
└──────────────────┬─────────────────────────────┘
                   │ export_to_kb
                   ▼
┌──────────────────────────────────────────────┐
│            Obsidian Vault 📥 收件箱            │
│                                                │
│  📥/memory/   ← 摘要（手动存 + 自动 tick）      │
│  📥/原始资料/  ← 全量对话原文                    │
└──────────────────┬─────────────────────────────┘
                   │ sort.js --fix 自动分拣
                   ▼
┌──────────────────────────────────────────────┐
│           九层知识库架构                        │
│                                                │
│  原始资料/  → 全量对话 → 提炼 → 神经元/        │
│  神经元/   → 原子化知识                        │
│  迷宫/     → 导航（房间/走廊/墙壁）              │
│  记忆/     → 记忆金字塔（会话→记忆→经验→结晶）   │
└──────────────────────────────────────────────┘
```

## 导出流程

```
Agent 每 10-15 轮调 memory_log_tick
  → 存到 mnemonic（namespace 级，session-log）
  → 管理界面 Timeline 可见

用户说"记住这个"
  → Agent 调 memory_add（指定 level/project/tags）
  → 存到 mnemonic（三层隔离）

export_to_kb 按 project 筛选
  → 摘要 → 📥/memory/
  → 全量对话 → 📥/原始资料/
  → sort.js 自动分拣
```

## 三层隔离映射

| mnemonic level | KB 目录 | sort.js type | 场景 |
|---------------|---------|-------------|------|
| `global` | 记忆/ | `fact` | 通用经验、调试技巧 |
| `project`（自研） | 记忆/ | `fact` | 自己项目的决策、架构 |
| `project`（研究） | 神经元/ | `concept` | 外部项目分析、研究笔记 |

研究 vs 自研由 `kb-mapping.json` 中的映射控制。

## 配置

### 环境变量

```bash
# mnemonic 自身
MNEMONIC_PORT=3457
MNEMONIC_NAMESPACE=your-agent-name
MNEMONIC_DB_DIR=/path/to/mnemonic/data

# 知识库导出（自定义）
MNEMONIC_KB_PATH=/path/to/your/obsidian-vault
MNEMONIC_SESSIONS_DIR=/path/to/your/agent/sessions   # 全量对话来源
```

### 项目映射

编辑 `kb-mapping.json` 定义每个项目导出到知识库的哪个层：

```json
{
  "default_kb": "memory",
  "inbox": "📥",
  "projects": {
    "my-own-project":   { "kb": "memory",  "type": "fact" },
    "external-research": { "kb": "neurons", "type": "concept" }
  },
  "tag_overrides": {
    "借鉴":   { "kb": "neurons", "type": "concept" },
    "research": { "kb": "neurons", "type": "concept" }
  }
}
```

## 导出类型

| type | 内容 | 目标目录 | KB 用途 |
|------|------|---------|--------|
| `summary` | 记忆摘要 | 📥/memory/ | 查漏补缺 |
| `full` | 全量对话 | 📥/原始资料/ | 深度提炼（事实→经验→结晶） |
| `both` | 两者都导 | 两者 | 同时满足快速查阅和深度提炼 |

## 导出文件格式

### 摘要

```markdown
---
type: fact
mnemonic_project: "my-project"
mnemonic_type: "summary"
created: 2026-06-02
tags: ["architecture", "design"]
source: "manual save"
---

memory content...
```

### 全量对话

```markdown
---
type: raw
mnemonic_project: "my-project"
mnemonic_type: "full_conversation"
provenance:
  source: "reasonix-session"
  session: "desktop-20260601-1.jsonl"
---

# 会话记录

### 🙋 用户
用户消息...

### 🤖 AI
AI 回复...

### 🔧 工具调用
> **工具：** read_file
```

## sort.js 分拣规则

运行 `sort.js --fix` 后：

| 文件特征 | 目标 |
|---------|------|
| `type: raw`, `mnemonic_type: full_conversation` | 原始资料/ |
| `type: fact` | 记忆/ |
| `type: concept` | 神经元/ |

## 使用示例

```bash
# 导出某个项目（摘要 + 全量对话）
curl "http://localhost:3457/api/export?project=my-project&type=both"

# 导出 global 通用经验
curl "http://localhost:3457/api/export?project=global&type=summary"

# 预览模式
curl "http://localhost:3457/api/export?project=my-project&type=both&dry_run=true"

# MCP 工具调用
export_to_kb({ project: "my-project", type: "both", dry_run: true })
```
