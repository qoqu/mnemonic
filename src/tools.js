/**
 * mnemonic — MCP tool definitions
 *
 * Tools are registered as plain JSON Schema arrays (not Zod)
 * because McpServer v1.29 forces Zod. Using the low-level
 * Server API instead to keep schemas clean.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as store from './store.js';
import { truncateByBudget, estimateTokens, withBudgetInfo } from './token-budget.js';
import { renderSkeletons, estimateSkeletonTokens } from './skeleton-renderer.js';

// ── 工具元数据 ────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'memory_add',
    description: `Add a memory entry to the shared store.

AUTO-CAPTURE RULE: After completing ANY significant action (file edit, decision, discovery, config change, bug fix, architecture decision), automatically call this tool to save the key findings. Do NOT wait for the user to ask.

3-layer isolation controlled by the 'level' param:
  - "auto" (default): project set → project-level; namespace set → namespace-level; else global
  - "global": visible to every agent and every project
  - "namespace": visible only to the current agent (e.g., Hermes' own preferences)
  - "project": visible only to the current agent's project

Importance levels:
  - "low":    Minor detail, transient note
  - "normal": Useful info (default)
  - "high":   Important decision, design choice, bug root cause
  - "critical": Security issue, breaking change, irreversible action

Usage tips (model instructions):
  - User corrects you → save as "namespace"
  - Project-specific convention → save as "project"
  - Universal knowledge → save as "global"
  - Not sure → let "auto" decide
  - IMPORTANT action → use importance="high" or "critical"`,
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
        importance: {
          type: 'string', enum: ['low', 'normal', 'high', 'critical'],
          description: '重要程度，默认 normal。high 表示重要决策/设计，critical 表示安全/不可逆操作',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_search',
    description: `Progressive search with structured skeletons. Three layers:

  Layer 1 — search(query, mode="index"):    return structured skeleton (topics, entities, type, relations). ~100 tokens/item.
  Layer 2 — memory_preview(ids):            return selected items with full content.
  Layer 3 — memory_get(id):                 return a single item with full content.

The skeleton includes:
  - topics: key concepts extracted from content
  - entities: named technologies and references
  - type: classification (architecture/decision/rule/bugfix/config/workflow/insight)
  - relations: cross-references between projects (on "full" density)

Budget-aware: pass budget=N to auto-adjust skeleton density.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        mode: { type: 'string', enum: ['index', 'full'], description: 'index=紧凑(默认) full=完整' },
        levels: { type: 'array', items: { type: 'string', enum: ['global', 'namespace', 'project'] } },
        namespace: { type: 'string', description: '按 agent 过滤' },
        project: { type: 'string', description: '按项目过滤' },
        limit: { type: 'number', description: '返回上限，默认 20' },
        budget: { type: 'number', description: 'Token budget limit (optional)' },
      },
    },
  },
  {
    name: 'memory_preview',
    description: 'Layer 2 of progressive search. Get selected memories by IDs with full content.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Memory IDs to preview' },
      },
      required: ['ids'],
    },
  },
  {
    name: 'memory_get',
    description: 'Layer 3 of progressive search. Get a single memory by ID with full content.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
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
        budget: { type: 'number', description: 'Token budget limit (optional)' },
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
    description: `Export memories / full conversations to knowledge base inbox.

AUTO-SYNC: Before session end, automatically call this tool to sync new memories
to your Obsidian Vault. Only NEW memories (not in export_log) are exported — safe
to call multiple times.

Two export modes via the 'type' param:
  "summary" (default) — export memory summaries to KB (uses kb-mapping.json)
  "full"             — export full conversation transcripts from session files
  "both"             — export both summaries + full conversations

Mapping rules (summary mode):
  - Project name → kb-mapping.json determines target (memory/neurons/raw)
  - Tag overrides can override target for specific tags
  - Unmapped projects default to "memory"

Config:
  MNEMONIC_KB_PATH      — Obsidian Vault root (required)
  MNEMONIC_SESSIONS_DIR — session files directory (default: ~/.reasonix/sessions)
`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project name to export (required)' },
        since: { type: 'string', description: 'Only export after this date (ISO, e.g. 2026-01-01)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Only export memories with these tags' },
        type: { type: 'string', enum: ['summary', 'full', 'both'], description: 'Export type. Default summary' },
        dry_run: { type: 'boolean', description: 'Preview without writing files' },
      },
      required: [],
    },
  },
  {
    name: 'conversation_save',
    description: `Save a full conversation session for device migration.

Stores the entire conversation content in the database so it can be
retrieved on another device. Not shown in the admin UI.

Use this at session end or periodically during long sessions.
Call conversation_list to find sessions, then conversation_get to retrieve.`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Unique session identifier (e.g., the session file name)' },
        namespace: { type: 'string', description: 'Agent namespace (MCP Host auto-fills)' },
        project: { type: 'string', description: 'Current project name' },
        content: { type: 'string', description: 'Full conversation content (JSONL or markdown format)' },
        turn_count: { type: 'number', description: 'Number of conversation turns' },
        summary: { type: 'string', description: 'Brief summary of this session (1-2 sentences)' },
      },
      required: ['session_id', 'content'],
    },
  },
  {
    name: 'conversation_list',
    description: 'List saved full conversations for device migration. Returns metadata (id, session, project, turns, date) without the full content.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Filter by agent namespace' },
        project: { type: 'string', description: 'Filter by project name' },
        limit: { type: 'number', description: 'Max results (default 50)' },
      },
    },
  },
  {
    name: 'conversation_get',
    description: 'Retrieve a full conversation by session_id. Returns the complete content for context restoration on a new device.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier (from conversation_list)' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'conversation_remove',
    description: 'Remove a stored full conversation by session_id.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session identifier to remove' },
      },
      required: ['session_id'],
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
  {
    name: 'conversation_import',
    description: `Import all session files from a directory into the conversations table.

Reads all .jsonl files from MNEMONIC_SESSIONS_DIR (or the specified directory),
saves each to the conversations table, overwriting any existing data.

Use this for bulk migration — imports all sessions at once.`,
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Agent namespace (default: from env)' },
        project: { type: 'string', description: 'Default project for sessions without mapping' },
        sessions_dir: { type: 'string', description: 'Path to session files directory (default: $MNEMONIC_SESSIONS_DIR)' },
        session_map: { type: 'string', description: 'JSON mapping of session_id→project, e.g. {"session-1":"proj"}' },
      },
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
        importance: args.importance || 'normal',
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
      const budget = args.budget;
      const mode = args.mode || 'index';
      if (mode === 'index') {
        const skeletons = renderSkeletons(memories, { budget });
        // 按 token 预算截断骨架
        let result = skeletons;
        if (budget) {
          const withCost = result.map(s => ({ s, cost: estimateSkeletonTokens(s) }));
          let total = 0, idx = 0;
          while (idx < withCost.length && total + withCost[idx].cost <= budget) {
            total += withCost[idx].cost;
            idx++;
          }
          result = withCost.slice(0, idx).map(w => w.s);
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      const truncated = budget ? truncateByBudget(memories, budget) : memories;
      return { content: [{ type: 'text', text: JSON.stringify(truncated) }] };
    },

    memory_preview: (args) => {
      const memories = store.getByIds(args.ids || []);
      return { content: [{ type: 'text', text: JSON.stringify(memories) }] };
    },

    memory_get: (args) => {
      const memory = store.getById(args.id);
      if (!memory) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Memory not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(memory) }] };
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
      const result = args.budget ? truncateByBudget(memories, args.budget) : memories;
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
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
        type: args.type || 'summary',
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
        importance: 'low',
      });
      return { content: [{ type: 'text', text: JSON.stringify({ id: result.id, logged: true }) }] };
    },

    // ── 设备迁移 ──────────────────────────────────────────────────
    conversation_import: (args) => {
      const ctx = getSessionContext();
      const sessionsDir = args.sessions_dir || process.env.MNEMONIC_SESSIONS_DIR;
      if (!sessionsDir) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'sessions_dir required or set MNEMONIC_SESSIONS_DIR' }) }], isError: true };
      }
      const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl') && !f.includes('.bak'));
      const namespace = args.namespace || ctx.namespace || 'default';
      const defaultProject = args.project || ctx.project || '';

      // Optional session→project mapping via JSON env var or parameter
      let projectMap = {};
      try {
        const mapStr = args.session_map || process.env.MNEMONIC_SESSION_MAP || '{}';
        projectMap = JSON.parse(mapStr);
      } catch {}

      let imported = 0, errors = 0;
      for (const file of files) {
        const sessionId = file.replace('.jsonl', '');
        try {
          const content = readFileSync(join(sessionsDir, file), 'utf8');
          const lines = content.split('\n').filter(l => l.trim()).length;
          const project = projectMap[sessionId] || defaultProject;
          // Extract date from filename: desktop-YYYYMMDD... → YYYY-MM-DD
          const dateMatch = sessionId.match(/(\d{4})(\d{2})(\d{2})/);
          const createdDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T00:00:00.000Z` : undefined;
          store.convSave({
            session_id: sessionId, namespace, project,
            content, turn_count: lines, created: createdDate,
            summary: `Imported from ${file} (${lines} turns)`,
          });
          imported++;
        } catch (e) {
          errors++;
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ imported, errors, total: files.length }) }] };
    },

    conversation_save: (args) => {
      const ctx = getSessionContext();
      const result = store.convSave({
        session_id: args.session_id,
        namespace: args.namespace || ctx.namespace || 'default',
        project: args.project || ctx.project || '',
        content: args.content,
        turn_count: args.turn_count || 0,
        summary: args.summary || '',
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    conversation_list: (args) => {
      const ctx = getSessionContext();
      const result = store.convList({
        namespace: args.namespace || ctx.namespace,
        project: args.project || ctx.project,
        limit: args.limit || 50,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    conversation_get: (args) => {
      const result = store.convGet(args.session_id);
      if (!result) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    conversation_remove: (args) => {
      const result = store.convDelete(args.session_id);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  };
}
