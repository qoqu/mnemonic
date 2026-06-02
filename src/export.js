/**
 * mnemonic — export to knowledge base
 *
 * Two export modes:
 *   "summary" — export memory summaries to KB
 *   "full"    — read session files, export full conversation transcripts
 *   "both"    — do both
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────

const SESSIONS_DIR = process.env.MNEMONIC_SESSIONS_DIR || '';

// ── Load mapping ──────────────────────────────────────────────────────

let _mapping = null;

function getMapping() {
  if (_mapping) return _mapping;
  const path = join(__dirname, '..', 'kb-mapping.json');
  if (existsSync(path)) {
    _mapping = JSON.parse(readFileSync(path, 'utf8'));
  } else {
    _mapping = { default_kb: 'memory', inbox: '📥', projects: {}, tag_overrides: {} };
  }
  return _mapping;
}

function resolveTarget(project, tags) {
  const mapping = getMapping();
  if (tags && mapping.tag_overrides) {
    for (const tag of tags) {
      if (mapping.tag_overrides[tag]) return mapping.tag_overrides[tag];
    }
  }
  if (mapping.projects[project]) return mapping.projects[project];
  return { kb: mapping.default_kb || 'memory', type: 'fact' };
}

// ── Frontmatter ───────────────────────────────────────────────────────

function buildFrontmatter(mem) {
  let mnemonicType = 'manual_save';
  if (mem.source === 'tick' || (mem.tags && mem.tags.includes('session-log'))) mnemonicType = 'summary';

  return [
    '---',
    `type: fact`,
    `mnemonic_project: "${mem.project || ''}"`,
    `mnemonic_type: "${mnemonicType}"`,
    `created: ${(mem.created || '').slice(0, 10)}`,
    `tags: [${(mem.tags || []).map(t => `"${t}"`).join(', ')}]`,
    `source: "${mem.source || ''}"`,
    '---',
    '',
    mem.content,
  ].join('\n');
}

function buildConversationFrontmatter(sessionFile, project, tags, targetType) {
  return [
    '---',
    `type: ${targetType || 'raw'}`,
    `mnemonic_project: "${project || ''}"`,
    `mnemonic_type: "full_conversation"`,
    `created: ${sessionFile.slice(0, 10)}`,
    'provenance:',
    '  source: "reasonix-session"',
    `  session: "${sessionFile}"`,
    `tags: [${(tags || []).map(t => `"${t}"`).join(', ')}]`,
    '---',
    '',
    `# 会话记录 — ${project || '未知项目'}`,
    '',
    `> 源文件：\`${sessionFile}\``,
    '',
  ].join('\n');
}

// ── Read session file ─────────────────────────────────────────────────

function readSessionFile(sessionId) {
  const path = join(SESSIONS_DIR, sessionId);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return raw.split('\n').filter(l => l.trim()).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ── Format conversation to markdown ────────────────────────────────────

function formatConversation(entries) {
  const lines = [];
  for (const e of entries) {
    if (e.role === 'user') {
      lines.push('');
      lines.push(`### 🙋 用户`);
      lines.push('');
      lines.push(e.content || '');
    } else if (e.role === 'assistant') {
      lines.push('');
      lines.push(`### 🤖 AI`);
      lines.push('');
      if (e.content) lines.push(e.content);
      if (e.tool_calls) {
        for (const tc of e.tool_calls) {
          lines.push('');
          lines.push(`> **工具调用：** \`${tc.function?.name || 'unknown'}\``);
          try {
            const args = JSON.parse(tc.function?.arguments || '{}');
            lines.push(`> \`\`\`json`);
            lines.push(`> ${JSON.stringify(args, null, 2).split('\n').join('\n> ')}`);
            lines.push(`> \`\`\``);
          } catch {
            lines.push(`> ${(tc.function?.arguments || '').substring(0, 200)}`);
          }
        }
      }
    } else if (e.role === 'tool') {
      lines.push('');
      lines.push(`> **[工具结果] ${e.name || ''}**`);
      const content = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
      if (content.length > 300) {
        lines.push(`> \`\`\`\n> ${content.substring(0, 300)}...\n> \`\`\``);
      } else {
        lines.push(`> \`\`\`\n> ${content}\n> \`\`\``);
      }
    }
  }
  return lines.join('\n');
}

// ── Extract session IDs from memories ─────────────────────────────────

function extractSessionIds(memories) {
  const ids = new Set();
  for (const mem of memories) {
    const src = mem.source || '';
    // Match patterns like "会话 desktop-202605181311-1" or "desktop-202605181311-1"
    const match = src.match(/(desktop-\d+-\d+\.jsonl)/);
    if (match) ids.add(match[1]);
    // Also check for bare session IDs
    const match2 = src.match(/(desktop-\d+-\d+)/);
    if (match2 && !match2[1].endsWith('.jsonl')) ids.add(match2[1] + '.jsonl');
  }
  return [...ids];
}

// ── Main export ───────────────────────────────────────────────────────

export function exportToKb({ project, since, tags, dryRun, namespace, type }) {
  const vaultPath = process.env.MNEMONIC_KB_PATH;
  if (!vaultPath) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'MNEMONIC_KB_PATH not set' }) }],
      isError: true,
    };
  }

  const exportType = type || 'summary';
  const mapping = getMapping();
  const inbox = mapping.inbox || '📥';
  const target = resolveTarget(project, tags);
  const results = { summary: 0, full: 0 };

  // ── Query memories ──────────────────────────────────────────
  const query = store.search({
    query: '', levels: ['project', 'global', 'namespace'],
    namespace: namespace || 'default', project: project || '', limit: 500,
  });

  let filtered = query;
  if (since) { const d = new Date(since); filtered = filtered.filter(m => new Date(m.updated) >= d); }
  if (tags && tags.length > 0) {
    filtered = filtered.filter(m => (m.tags || []).some(t => tags.includes(t)));
  }

  if (filtered.length === 0 && exportType !== 'full') {
    return { content: [{ type: 'text', text: JSON.stringify({ exported: 0, message: 'No memories matched' }) }] };
  }

  // ── Dry run ──────────────────────────────────────────────────
  if (dryRun) {
    let info = { dry_run: true, matched: filtered.length, type: exportType };
    if (exportType === 'full' || exportType === 'both') {
      const sessionIds = extractSessionIds(filtered);
      info.full_conversations = sessionIds.length;
      info.session_files = sessionIds;
    }
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  }

  // ── Export summaries ─────────────────────────────────────────
  if (exportType === 'summary' || exportType === 'both') {
    const inboxDir = join(vaultPath, inbox, target.kb);
    if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

    for (const mem of filtered) {
      const fm = buildFrontmatter(mem);
      const slug = (mem.content || '').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 40);
      writeFileSync(join(inboxDir, `mnemonic_${mem.project || 'unknown'}_${slug}.md`), fm, 'utf8');
      results.summary++;
    }
  }

  // ── Export full conversations ────────────────────────────────
  if (exportType === 'full' || exportType === 'both') {
    const targetType = (target && target.type) || 'raw';
    const inboxDir = join(vaultPath, inbox, '原始资料');
    if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

    const sessionIds = extractSessionIds(filtered);
    for (const sid of sessionIds) {
      const entries = readSessionFile(sid);
      if (!entries) continue;

      const firstUserMsg = entries.find(e => e.role === 'user');
      const slug = (firstUserMsg ? firstUserMsg.content.substring(0, 40) : sid).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
      const fm = buildConversationFrontmatter(sid, project, tags, targetType);
      const body = formatConversation(entries);
      writeFileSync(join(inboxDir, `会话_${project}_${slug}.md`), fm + '\n' + body, 'utf8');
      results.full++;
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        exported: results,
        project,
        inbox_path: join(vaultPath, inbox),
      }, null, 2),
    }],
  };
}
