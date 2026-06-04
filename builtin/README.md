# mnemonic-builtin — Reasonix 内置记忆工具

无需启动外部 MCP 服务，直接在 Reasonix 进程内读写记忆库。

## 安装

将 `mnemonic-builtin.cjs` 放在任意位置，然后通过 Reasonix skill 调用。

## 用法

```bash
# 设置数据库路径（默认：脚本所在目录的 .reasonix/memory/）
set MNEMONIC_DB_DIR=D:\同步盘路径\mnemonic

# 添加记忆
node mnemonic-builtin.cjs add '{"content":"API 设计原则：接口应该幂等","level":"global","importance":"normal"}'

# 搜索
node mnemonic-builtin.cjs search '{"query":"架构","mode":"index"}'

# 获取单条
node mnemonic-builtin.cjs get '{"id":"mem_abc12345"}'

# 统计
node mnemonic-builtin.cjs stats

# 保存对话
node mnemonic-builtin.cjs conv_save '{"session_id":"my-session","content":"..."}'

# 列出对话
node mnemonic-builtin.cjs conv_list '{"namespace":"reasonix"}'
```

## 命令列表

| 命令 | 参数 | 说明 |
|------|------|------|
| `add` | content, level?, importance?, tags?, source? | 添加记忆 |
| `search` | query?, importance?, levels?, namespace?, project?, limit?, mode? | 搜索 |
| `get` | id | 取单条 |
| `list` | levels?, importance?, namespace?, project?, limit? | 列表 |
| `remove` | id 或 old_text | 删除 |
| `stats` | - | 统计 |
| `conv_save` | session_id, content, namespace?, project? | 保存对话 |
| `conv_list` | namespace?, project?, limit? | 对话列表 |
| `conv_get` | session_id | 取对话内容 |
