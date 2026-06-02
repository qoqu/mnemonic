# mnemonic + Obsidian Vault 知识库集成方案

> 适用于 `kb-integration` 分支
> 知识库版本：v2.0 · 九层融合架构

---

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    mnemonic MCP                       │
│  （全局记忆管理器 · 三层隔离 · 跨会话跨设备持久化）      │
│                                                       │
│  memory_add / memory_search / memory_log_tick         │
│  export_to_kb (summary / full / both)                 │
└────────────────────┬──────────────────────────────────┘
                     │ export_to_kb
                     ▼
┌─────────────────────────────────────────────────────┐
│              Obsidian Vault  📥 收件箱                │
│                                                       │
│  📥/memory/       ← 摘要（手动存 + 自动 tick）         │
│  📥/原始资料/      ← 全量对话原文                       │
└────────────────────┬──────────────────────────────────┘
                     │ sort.js --fix 自动分拣
                     ▼
┌─────────────────────────────────────────────────────┐
│              九层知识库架构                             │
│                                                       │
│  原始资料/  ← 全量对话 → 提炼 → 神经元/                │
│  神经元/   ← 原子化知识                               │
│  迷宫/     ← 导航（房间/走廊/墙壁）                     │
│  记忆/     ← 记忆金字塔提炼流程                         │
│    会话/   →  memories/  →  lessons/  →  crystals/    │
│  人物/     ← 真实人物关系                              │
└─────────────────────────────────────────────────────┘
```

## 数据流

### 导出流程

```
Agent 每 10-15 轮调 memory_log_tick
  → 存到 mnemonic（namespace 级，自动标签 session-log）
  → 管理界面 Timeline 可见

遇到值得记的知识，用户说"记住这个"
  → Agent 调 memory_add（指定 level/project/tags）
  → 存到 mnemonic（三层隔离）

定期运行 export_to_kb
  → 按 project 筛选记忆
  → 摘要导出到 📥/memory/
  → 全量对话导出到 📥/原始资料/
  → 知识库 sort.js 自动分拣
```

### 提炼流程（知识库侧）

```
📥/原始资料/（全量对话原文）
  │ sort.js
  ▼
原始资料/（不可变存档）
  │ Agent 提炼
  ▼
神经元/（原子化知识）
  │ 连接 → 迷宫/（导航）
  ▼
记忆/（四层金字塔）
  会话/ → memories/ → lessons/ → crystals/
```

## 三层隔离映射

| mnemonic level | 对应 KB 目录 | sort.js type |
|---------------|-------------|-------------|
| `global` | 记忆/ (通用经验) | `fact` |
| `project` (自研类) | 记忆/ | `fact` |
| `project` (研究类) | 神经元/ | `concept` |

研究 vs 自研的区分由 `kb-mapping.json` 中的 `projects` 和 `tag_overrides` 控制。

## 配置

### 环境变量

```bash
# mnemonic 配置
MNEMONIC_PORT=3457
MNEMONIC_NAMESPACE=reasonix
MNEMONIC_DB_DIR=D:\说剑与你听-60FFD3\华为家庭存储\知识库\mnemonic

# 导出配置
MNEMONIC_KB_PATH=D:\说剑与你听-60FFD3\华为家庭存储\知识库\Obsidian Vault
MNEMONIC_SESSIONS_DIR=C:\Users\qoqu\.reasonix\sessions
```

### 项目映射（kb-mapping.json）

```json
{
  "default_kb": "memory",
  "inbox": "📥",
  "projects": {
    "zidu-novel-studio":    { "kb": "memory",  "type": "fact" },
    "novel-world-engine":   { "kb": "memory",  "type": "fact" },
    "mnemonic":             { "kb": "memory",  "type": "fact" },
    "个人知识库":              { "kb": "memory",  "type": "fact" },
    "UUMit":                { "kb": "neurons", "type": "concept" },
    "DeepSeek-Reasonix":    { "kb": "neurons", "type": "concept" },
    "Edge 插件":              { "kb": "neurons", "type": "concept" },
    "reasonix-buddy":       { "kb": "neurons", "type": "concept" }
  },
  "tag_overrides": {
    "借鉴":   { "kb": "neurons", "type": "concept" },
    "研究":   { "kb": "neurons", "type": "concept" },
    "开源":   { "kb": "neurons", "type": "concept" }
  }
}
```

## 导出类型

| type | 导出内容 | 目标目录 | KB 用途 |
|------|---------|---------|--------|
| `summary` | 记忆摘要 | 📥/memory/ | 查漏补缺，直接可用 |
| `full` | 全量对话原文 | 📥/原始资料/ | 深度提炼（事实→经验→结晶） |
| `both` | 两者都导 | 上述两者 | 同时满足快速查阅和深度提炼 |

## 导出文件格式

### 摘要（📥/memory/）

```markdown
---
type: fact|concept
mnemonic_project: "zidu-novel-studio"
mnemonic_type: "summary|manual_save"
created: 2026-06-02
tags: ["架构", "zidu"]
source: "会话 desktop-202605181311-1.jsonl"
---

记忆内容...
```

### 全量对话（📥/原始资料/）

```markdown
---
type: raw
mnemonic_project: "zidu-novel-studio"
mnemonic_type: "full_conversation"
created: 2026-05-18
provenance:
  source: "reasonix-session"
  session: "desktop-202605181311-1.jsonl"
tags: ["zidu", "架构"]
---

# 会话记录 — zidu-novel-studio

### 🙋 用户
研究内容...

### 🤖 AI
分析结果...

### 🔧 工具调用
> **工具：** read_file
> 参数...
```

## 与 KB 工作流的关系

### sort.js 分拣规则

导出到 📥/ 后，运行 `sort.js --fix`：

| 文件特征 | 分拣目标 |
|---------|---------|
| `type: raw`, `mnemonic_type: full_conversation` | 原始资料/ |
| `type: fact`, `mnemonic_project: *` | 记忆/ |
| `type: concept`, `mnemonic_project: *` | 神经元/ |

### 写入锁

批量导出时 mnemonic 不创建锁（一次性操作，写完即止）。
知识库侧 `decay.js` / `crosslink.js` 等工作时如果遇到 mnemonic 导出的文件，正常处理。

## 使用示例

```bash
# 导出某个项目的全部内容（摘要 + 全量对话）
curl "http://localhost:3457/api/export?project=zidu-novel-studio&type=both"

# 导出 global 通用经验
curl "http://localhost:3457/api/export?project=global&type=summary"

# 预览（不写文件）
curl "http://localhost:3457/api/export?project=mnemonic&type=both&dry_run=true"

# MCP 工具调用
export_to_kb({
  project: "zidu-novel-studio",
  type: "both",
  tags: ["架构"],
  dry_run: false
})
```
