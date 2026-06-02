# mnemonic — Obsidian Vault 知识库集成

本分支（`kb-integration`）包含 mnemonic 与 Obsidian Vault 知识库记忆层的集成方案。

## 架构

```
mnemonic（知识与会话日志）
    │
    │ export_to_kb（按 project/时间/标签筛选）
    │
    ▼
Obsidian Vault 📥/ 收件箱
    │
    │ neurons/（研究类 → concept）
    │ memory/（自研项目 → fact）
    │ raw/（资料 → raw）
    │
    ▼
记忆提炼流程：sessions → memories → lessons → crystals
```

## 配置

### 1. 设置知识库路径

```bash
# 指向你的 Obsidian Vault 根目录
set MNEMONIC_KB_PATH=D:\说剑与你听-60FFD3\华为家庭存储\知识库\Obsidian Vault
```

### 2. 项目映射

编辑 `kb-mapping.json`，配置每个 project 导出到知识库的哪个层：

```json
{
  "default_kb": "memory",
  "inbox": "📥",
  "projects": {
    "zidu-novel-studio": { "kb": "memory", "type": "fact" },
    "DeepSeek-Reasonix": { "kb": "neurons", "type": "concept" },
    "Edge 插件":          { "kb": "neurons", "type": "concept" }
  },
  "tag_overrides": {
    "借鉴": { "kb": "neurons", "type": "concept" }
  }
}
```

映射规则优先级：
1. **Tag 覆盖** — 如果记忆包含 `tag_overrides` 中的标签，优先使用该目标
2. **Project 映射** — 按 project 名查找
3. **默认值** — 未匹配的 project 导出到 `memory/`

## 使用

### MCP 工具

```
export_to_kb({
  project: "zidu-novel-studio",   // 必填
  since: "2026-01-01",            // 可选，时间筛选
  tags: ["架构"],                   // 可选，标签筛选
  dry_run: true                    // 预览模式，不写文件
})
```

### REST API

```bash
# 预览（不写文件）
curl "http://localhost:3457/api/export?project=zidu-novel-studio&dry_run=true"

# 执行导出
curl "http://localhost:3457/api/export?project=novel-world-engine&since=2026-05-01"

# 按标签过滤
curl "http://localhost:3457/api/export?project=zidu-novel-studio&tags=架构"
```

## 导出文件格式

导出到收件箱的每个文件包含完整的 frontmatter：

```markdown
---
type: concept|fact|raw
mnemonic_project: "project-name"
mnemonic_type: "summary|manual_save|full_conversation"
created: 2026-06-02
tags: ["tag1", "tag2"]
source: "tick|zidu-调试迭代|..."
---

记忆内容正文...
```

## 区分逻辑

| mnemonic 来源 | mnemonic_type | 知识库用途 |
|--------------|---------------|-----------|
| `memory_add`（手动存） | `manual_save` | 查漏补缺，直接可用 |
| `memory_log_tick`（自动日志） | `summary` | 时间轴回顾，不深度提炼 |
| `source: "full_conversation"` | `full_conversation` | 深度提炼（事实→经验→结晶） |

## environment

| 变量 | 说明 |
|------|------|
| `MNEMONIC_KB_PATH` | Obsidian Vault 根目录路径，必填 |
