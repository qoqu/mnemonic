/**
 * reasonix-memory — 存储逻辑（node:sqlite 版）
 *
 * 三层隔离（global / namespace / project）的增删改查。
 */

import { randomUUID } from 'crypto';
import { getDb } from './db.js';

// ── 工具函数 ──────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function parseTags(tags) {
  if (!tags) return '[]';
  if (Array.isArray(tags)) return JSON.stringify(tags);
  if (typeof tags === 'string') {
    try { JSON.parse(tags); return tags; } catch { return JSON.stringify([tags]); }
  }
  return '[]';
}

function resolveLevel(level, namespace, project) {
  if (level && level !== 'auto') return level;
  if (project) return 'project';
  if (namespace) return 'namespace';
  return 'global';
}

function rowsToMemories(rows) {
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    level: r.level,
    namespace: r.namespace,
    project: r.project,
    tags: JSON.parse(r.tags || '[]'),
    source: r.source,
    access_count: r.access_count,
    created: r.created,
    updated: r.updated,
  }));
}

// ── 查询构建 ─────────────────────────────────────────────────────────

function buildScopeFilter(opts) {
  const conditions = [];
  const params = [];

  if (opts.levels && opts.levels.length > 0) {
    const ph = opts.levels.map(() => '?');
    conditions.push(`level IN (${ph.join(',')})`);
    params.push(...opts.levels);
  }

  if (opts.namespace) {
    conditions.push('namespace = ?');
    params.push(opts.namespace);
  }

  if (opts.project) {
    conditions.push('project = ?');
    params.push(opts.project);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function add({ content, level, namespace, project, tags, source }) {
  const db = getDb();
  const id = `mem_${randomUUID().slice(0, 8)}`;
  const resolvedLevel = resolveLevel(level, namespace, project);
  const ts = now();
  const tagsJson = parseTags(tags);

  db.prepare(`
    INSERT INTO memories (id, content, level, namespace, project, tags, source, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, content, resolvedLevel, namespace || '', project || '', tagsJson, source || '', ts, ts);

  return { id, level: resolvedLevel };
}

export function search({ query, levels, namespace, project, limit = 20 }) {
  const db = getDb();

  if (query && query.trim()) {
    const scope = buildScopeFilter({ levels, namespace, project });
    const sql = `
      SELECT m.*
      FROM memories_fts f
      JOIN memories m ON f.rowid = m.rowid
      ${scope.where ? `${scope.where} AND` : 'WHERE'} memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...scope.params, query.trim(), limit);
    const memories = rowsToMemories(rows);

    if (memories.length > 0) {
      const ids = memories.map(m => m.id);
      const ph = ids.map(() => '?');
      db.prepare(`UPDATE memories SET access_count = access_count + 1 WHERE id IN (${ph.join(',')})`).run(...ids);
    }

    return memories;
  }

  const scope = buildScopeFilter({ levels, namespace, project });
  const sql = `SELECT * FROM memories ${scope.where} ORDER BY updated DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...scope.params, limit);
  return rowsToMemories(rows);
}

export function remove({ id, old_text, namespace }) {
  const db = getDb();

  if (id) {
    const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);
    return { deleted: Number(result.changes) > 0 };
  }

  if (old_text) {
    const stmt = db.prepare("DELETE FROM memories WHERE content LIKE ?");
    const result = stmt.run(`%${old_text}%`);
    return { deleted: Number(result.changes) > 0 };
  }

  return { deleted: false, error: '需要 id 或 old_text' };
}

export function update({ id, content, tags, source }) {
  const db = getDb();
  const ts = now();
  const updates = [];
  const params = [];

  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  if (tags !== undefined) { updates.push('tags = ?'); params.push(parseTags(tags)); }
  if (source !== undefined) { updates.push('source = ?'); params.push(source); }
  if (updates.length === 0) return { updated: false };

  updates.push('updated = ?');
  params.push(ts);
  params.push(id);

  const result = db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return { updated: Number(result.changes) > 0 };
}

export function list({ levels, namespace, project, limit = 50 }) {
  const db = getDb();
  const scope = buildScopeFilter({ levels, namespace, project });
  const sql = `SELECT * FROM memories ${scope.where} ORDER BY updated DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...scope.params, limit);
  return rowsToMemories(rows);
}

export function stats({ namespace } = {}) {
  const db = getDb();

  const total = db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
  const byLevel = db.prepare('SELECT level, COUNT(*) as c FROM memories GROUP BY level').all();
  const recent = db.prepare("SELECT COUNT(*) as c FROM memories WHERE updated > datetime('now', '-7 days')").get().c;

  let nsCount = null;
  if (namespace) {
    nsCount = db.prepare('SELECT COUNT(*) as c FROM memories WHERE namespace = ?').get(namespace).c;
  }

  const topTags = db.prepare('SELECT tags, COUNT(*) as c FROM memories GROUP BY tags ORDER BY c DESC LIMIT 10').all();

  return {
    total,
    by_level: Object.fromEntries(byLevel.map(r => [r.level, r.c])),
    recent_7d: recent,
    namespace_count: nsCount,
    top_tag_groups: topTags.map(r => ({ group: r.tags, count: r.c })),
  };
}
