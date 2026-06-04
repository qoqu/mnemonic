/**
 * mnemonic-builtin — Reasonix 内置记忆工具
 *
 * 用法：node 此文件 <命令> [参数JSON]
 *   例：node mnemonic-builtin.js add '{"content":"xxx","level":"global"}'
 *       node mnemonic-builtin.js search '{"query":"架构"}'
 *
 * 依赖：Node 22+ 内置 node:sqlite，零外部依赖。
 */

const DB_DIR = process.env.MNEMONIC_DB_DIR || require('path').join(__dirname, '.reasonix', 'memory');
const DB_PATH = require('path').join(DB_DIR, 'memories.db');

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('crypto');
const { existsSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

// ── DB 初始化 ──────────────────────────────────────────────────────────

let db;
function getDb() {
  if (db) return db;
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, content TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'namespace' CHECK(level IN ('global','namespace','project')),
    namespace TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '',
    importance TEXT NOT NULL DEFAULT 'normal' CHECK(importance IN ('low','normal','high','critical')),
    access_count INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, updated TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ms ON memories(level, namespace, project)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_mu ON memories(updated DESC)');

  db.exec(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL, turn_count INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL
  )`);
  return db;
}

function now() { return new Date().toISOString(); }

// ── 命令处理 ──────────────────────────────────────────────────────────

const handlers = {

  add(args) {
    const db = getDb();
    const id = `mem_${randomUUID().slice(0,8)}`;
    const ts = now();
    const level = args.level && args.level !== 'auto' ? args.level
      : args.project ? 'project' : args.namespace ? 'namespace' : 'global';
    const tags = Array.isArray(args.tags) ? JSON.stringify(args.tags) : '[]';
    db.prepare(`INSERT INTO memories(id,content,level,namespace,project,tags,source,importance,created,updated)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, args.content, level, args.namespace||'', args.project||'', tags, args.source||'', args.importance||'normal', ts, ts
    );
    return { id, level };
  },

  search(args) {
    const db = getDb();
    const cond = [], vals = [];
    if (args.query) { cond.push('(content LIKE ? OR tags LIKE ?)'); vals.push(`%${args.query}%`,`%${args.query}%`); }
    if (args.importance) { cond.push('importance = ?'); vals.push(args.importance); }
    if (args.levels) { cond.push(`level IN (${args.levels.map(()=>'?').join(',')})`); vals.push(...args.levels); }
    if (args.namespace) { cond.push('namespace = ?'); vals.push(args.namespace); }
    if (args.project) { cond.push('project = ?'); vals.push(args.project); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const limit = args.limit || 20;
    const rows = db.prepare(`SELECT * FROM memories ${where} ORDER BY updated DESC LIMIT ?`).all(...vals, limit);
    const mode = args.mode || 'index';
    return rows.map(r => ({
      id: r.id, snippet: mode === 'index' ? r.content.substring(0,120)+(r.content.length>120?'…':'') : r.content,
      level: r.level, importance: r.importance, tags: JSON.parse(r.tags||'[]'),
      project: r.project, created: r.created,
    }));
  },

  get(args) {
    const db = getDb();
    const r = db.prepare('SELECT * FROM memories WHERE id=?').get(args.id);
    if (!r) return null;
    return { ...r, tags: JSON.parse(r.tags||'[]') };
  },

  list(args) {
    const db = getDb();
    const cond = [], vals = [];
    if (args.levels) { cond.push(`level IN (${args.levels.map(()=>'?').join(',')})`); vals.push(...args.levels); }
    if (args.importance) { cond.push('importance = ?'); vals.push(args.importance); }
    if (args.namespace) { cond.push('namespace = ?'); vals.push(args.namespace); }
    if (args.project) { cond.push('project = ?'); vals.push(args.project); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM memories ${where} ORDER BY updated DESC LIMIT ?`).all(...vals, args.limit||50);
    return rows.map(r => ({ ...r, tags: JSON.parse(r.tags||'[]') }));
  },

  remove(args) {
    const db = getDb();
    if (args.id) { const r = db.prepare('DELETE FROM memories WHERE id=?').run(args.id); return {deleted:r.changes>0}; }
    if (args.old_text) { const r = db.prepare("DELETE FROM memories WHERE content LIKE ?").run(`%${args.old_text}%`); return {deleted:r.changes>0}; }
    return {deleted:false};
  },

  stats() {
    const db = getDb();
    return {
      total: db.prepare('SELECT COUNT(*) FROM memories').get()['COUNT(*)'],
      by_importance: db.prepare('SELECT importance, COUNT(*) FROM memories GROUP BY importance').all(),
    };
  },

  conv_save(args) {
    const db = getDb();
    const existing = db.prepare('SELECT id FROM conversations WHERE session_id=?').get(args.session_id);
    const id = existing ? existing.id : `conv_${randomUUID().slice(0,8)}`;
    const ts = now();
    db.prepare('INSERT OR REPLACE INTO conversations(id,session_id,namespace,project,content,turn_count,summary,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, args.session_id, args.namespace||'', args.project||'', args.content, args.turn_count||0, args.summary||'', args.created||ts, ts);
    return { id };
  },

  conv_list(args) {
    const db = getDb();
    const cond = [], vals = [];
    if (args.namespace) { cond.push('namespace=?'); vals.push(args.namespace); }
    if (args.project) { cond.push('project=?'); vals.push(args.project); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    return db.prepare(`SELECT id,session_id,namespace,project,turn_count,summary,created,updated FROM conversations ${where} ORDER BY updated DESC LIMIT ?`).all(...vals, args.limit||50);
  },

  conv_get(args) {
    const db = getDb();
    return db.prepare('SELECT * FROM conversations WHERE session_id=?').get(args.session_id) || null;
  },
};

// ── CLI ────────────────────────────────────────────────────────────────

const cmd = process.argv[2];
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

if (!handlers[cmd]) {
  console.error('Usage: node mnemonic-builtin.js <command> [argsJSON]');
  console.error('Commands: add, search, get, list, remove, stats, conv_save, conv_list, conv_get');
  process.exit(1);
}

try {
  const result = handlers[cmd](args);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
}
