/**
 * mnemonic — MCP tool definitions
 *
 * Tools are registered as plain JSON Schema arrays (not Zod)
 * because McpServer v1.29 forces Zod. Using the low-level
 * Server API instead to keep schemas clean.
 */

import * as store from './store.js';
import { exportToKb } from './export.js';

// ── 工具元数据 ────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'memory_add',
    description: `Add a memory entry to the shared store.

3-layer isolation controlled by the 'level' param:
  - "auto" (default): project set → project-level; namespace set → namespace-level; else global
  - "global": visible to every agent and every project
  - "namespace": visible only to the current agent (e.g., Hermes' own preferences)
  - "project": visible only to the current agent's project

Usage tips (model instructions):
  - User corrects you → save as "namespace"
  - Project-specific convention → save as "project"
  - Universal knowledge → save as "global"
  - Not sure → let "auto" decide`,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆内容' },
        level: {
          type: 'string',
          enum: ['auto', 'global', 'namespace', 'project'],
          description: '隔离层级，默认 auto 自动判断',
        },
        namespace: { type: 'string', description: '所属 agent（MCP Host 自动填充）' },
        project: { type: 'string', description: '所属项目（可选）' },
        tags: {
          type: 'array', items: { type: 'string' },
          description: '标签数组',
        },
        source: { type: 'string', description: '记忆来源' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: `Search memories via FTS5 full-text search with 3-layer isolation filtering.

Defaults to searching all levels. Use levels=["project"] to scope to current project.
Without query, returns most recently updated entries.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（FTS5）。不传则按最近更新排序' },
        levels: {
          type: 'array', items: { type: 'string', enum: ['global', 'namespace', 'project'] },
          description: '搜索范围，不传则搜所有层级',
        },
        namespace: { type: 'string', description: '按 agent 过滤' },
        project: { type: 'string', description: '按项目过滤' },
        limit: { type: 'number', description: '返回上限，默认 20' },
      },
    },
  },
  {
    name: 'memory_remove',
    description: 'Remove a memory. By exact id (preferred) or fuzzy old_text content match.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记忆 ID（优先级高于 old_text）' },
        old_text: { type: 'string', description: '按内容模糊匹配删除' },
        namespace: { type: 'string', description: '当前 agent 标识' },
      },
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing memory by id. Only the fields you pass are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_list',
    description: 'List memories by scope, sorted by most recently updated. Good for browsing.',
    inputSchema: {
      type: 'object',
      properties: {
        levels: { type: 'array', items: { type: 'string', enum: ['global', 'namespace', 'project'] } },
        namespace: { type: 'string' },
        project: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'memory_stats',
    description: 'Memory store statistics: totals by level, recent 7d activity, top tag groups.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: '查看某个 agent 的统计' },
      },
    },
  },
  {
    name: 'export_to_kb',
    description: `Export memories to knowledge base inbox.

Queries memories by project/time/tags, maps each to the correct KB directory
(via kb-mapping.json), generates markdown files with frontmatter, and writes
them to the inbox folder for later review and ingestion.

Mapping rules:
  - Project name → kb-mapping.json determines target (memory/neurons/raw)
  - Tag overrides can override target for specific tags (e.g. "借鉴" → neurons)
  - Unmapped projects default to "memory"

The inbox path is configured via MNEMONIC_KB_PATH env var.
`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name to export (required)' },
        since: { type: 'string', description: 'Only export memories after this date (ISO, e.g. 2026-01-01)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only export memories with these tags' },
        dry_run: { type: 'boolean', description: 'Preview what would be exported without writing files' },
      },
      required: ['project'],
    },
  },
  {
    name: 'memory_log_tick',
    description: `Lightweight session tick. Log what you're working on without polluting the memory store.

Use this every 10-20 turns to leave a breadcrumb of session activity.
Entries are auto-tagged "session-log" and stored at namespace level (invisible to other agents).

Unlike memory_add (for permanent knowledge), this is for lightweight context tracking.
Search via: memory_search(tags=["session-log"]) to replay your session timeline.

Parameters:
  - context: what you're doing right now (required, 1-2 sentences)
  - status: current phase — "exploring" / "building" / "fixing" / "reviewing" / "idle" / "done"
  - project: project you're working on (optional)`,
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'What you are doing right now (1-2 sentences)' },
        status: {
          type: 'string',
          enum: ['exploring', 'building', 'fixing', 'reviewing', 'idle', 'done'],
          description: 'Current work phase',
        },
        project: { type: 'string', description: 'Project you are working on (optional)' },
      },
      required: ['context'],
    },
  },
];

// ── 工具处理函数 ─────────────────────────────────────────────────────

export function createHandlers(getSessionContext) {
  return {
    memory_add: (args) => {
      const ctx = getSessionContext();
      const result = store.add({
        content: args.content,
        level: args.level || 'auto',
        namespace: args.namespace || ctx.namespace || 'default',
        project: args.project || ctx.project || '',
        tags: args.tags,
        source: args.source || '',
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    memory_search: (args) => {
      const ctx = getSessionContext();
      const memories = store.search({
        query: args.query || '',
        levels: args.levels,
        namespace: args.namespace || ctx.namespace,
        project: args.project || ctx.project,
        limit: args.limit || 20,
      });
      return { content: [{ type: 'text', text: JSON.stringify(memories) }] };
    },

    memory_remove: (args) => {
      const ctx = getSessionContext();
      const result = store.remove({
        id: args.id,
        old_text: args.old_text,
        namespace: args.namespace || ctx.namespace || 'default',
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    memory_update: (args) => {
      const result = store.update({ id: args.id, content: args.content, tags: args.tags, source: args.source });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    memory_list: (args) => {
      const ctx = getSessionContext();
      const memories = store.list({
        levels: args.levels,
        namespace: args.namespace || ctx.namespace,
        project: args.project || ctx.project,
        limit: args.limit || 50,
      });
      return { content: [{ type: 'text', text: JSON.stringify(memories) }] };
    },

    memory_stats: (args) => {
      const ctx = getSessionContext();
      const result = store.stats({ namespace: args.namespace || ctx.namespace });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    export_to_kb: (args) => {
      const ctx = getSessionContext();
      return exportToKb({
        project: args.project,
        since: args.since,
        tags: args.tags,
        dryRun: args.dry_run,
        namespace: ctx.namespace,
      });
    },

    memory_log_tick: (args) => {
      const ctx = getSessionContext();
      const tags = ['session-log', args.status || 'idle'];
      const content = `[${args.status || 'idle'}] ${args.context}`;
      const result = store.add({
        content,
        level: 'namespace',
        namespace: ctx.namespace || 'default',
        project: args.project || ctx.project || '',
        tags,
        source: 'tick',
      });
      return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, logged: true }) }] };
    },
  };
}
