/**
 * mnemonic — Persistent Work Queue
 *
 * SQLite 持久化工作队列。不依赖 Redis，进程崩溃后自动恢复。
 *
 * 状态流转：
 *   pending → processing → completed
 *                        → failed（可重试）
 */

import { getDb } from './db.js';
import { randomUUID } from 'crypto';

// ── Schema 初始化 ─────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS work_queue (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','processing','completed','failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wq_status ON work_queue(status);
  CREATE INDEX IF NOT EXISTS idx_wq_type ON work_queue(type, status);
`;

function ensureSchema() {
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_queue'").all();
  if (tables.length === 0) {
    db.exec(SCHEMA);
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────

function now() { return new Date().toISOString(); }

// ── API ───────────────────────────────────────────────────────────────

/**
 * 入队一个工作项。
 */
export function enqueue(type, payload, maxRetries = 3) {
  ensureSchema();
  const db = getDb();
  const id = `wq_${randomUUID().slice(0, 8)}`;
  const ts = now();

  db.prepare(
    'INSERT INTO work_queue (id, type, payload, status, max_retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, type, typeof payload === 'string' ? payload : JSON.stringify(payload), 'pending', maxRetries, ts, ts);

  return { id };
}

/**
 * 获取下一个待处理的工作项，标记为 processing。
 * 返回 null 表示队列为空。
 */
export function acquire() {
  ensureSchema();
  const db = getDb();

  // 先恢复卡在 processing 的任务（进程崩溃后重启）
  db.prepare(
    "UPDATE work_queue SET status = 'pending', updated_at = ? WHERE status = 'processing'"
  ).run(now());

  const row = db.prepare(
    "SELECT * FROM work_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
  ).get();

  if (!row) return null;

  db.prepare("UPDATE work_queue SET status = 'processing', updated_at = ? WHERE id = ?")
    .run(now(), row.id);

  return {
    id: row.id,
    type: row.type,
    payload: (() => { try { return JSON.parse(row.payload); } catch { return row.payload; } })(),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
  };
}

/**
 * 标记为完成。
 */
export function complete(id, result) {
  ensureSchema();
  getDb().prepare(
    "UPDATE work_queue SET status = 'completed', payload = ?, updated_at = ? WHERE id = ?"
  ).run(typeof result === 'string' ? result : JSON.stringify(result), now(), id);
}

/**
 * 标记为失败。可重试则重置为 pending，超出重试上限则保持 failed。
 */
export function fail(id, errorMsg) {
  ensureSchema();
  const db = getDb();
  const row = db.prepare('SELECT retry_count, max_retries FROM work_queue WHERE id = ?').get(id);
  if (!row) return;

  const retryCount = row.retry_count + 1;
  if (retryCount < row.max_retries) {
    db.prepare(
      "UPDATE work_queue SET status = 'pending', retry_count = ?, error = ?, updated_at = ? WHERE id = ?"
    ).run(retryCount, errorMsg || '', now(), id);
  } else {
    db.prepare(
      "UPDATE work_queue SET status = 'failed', retry_count = ?, error = ?, updated_at = ? WHERE id = ?"
    ).run(retryCount, errorMsg || '', now(), id);
  }
}

/**
 * 获取队列统计。
 */
export function stats() {
  ensureSchema();
  const db = getDb();
  const rows = db.prepare('SELECT status, COUNT(*) as c FROM work_queue GROUP BY status').all();
  const result = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const r of rows) result[r.status] = r.c;
  result.total = Object.values(result).reduce((a, b) => a + b, 0);
  return result;
}

/**
 * 清理已完成的任务。
 */
export function cleanup(olderThanDays = 7) {
  ensureSchema();
  const result = getDb().prepare(
    "DELETE FROM work_queue WHERE status IN ('completed', 'failed') AND updated_at < datetime('now', ?)"
  ).run(`-${olderThanDays} days`);
  return { deleted: result.changes };
}
