/**
 * mnemonic — 数据库层
 *
 * 使用 Node 22+ 内置 node:sqlite 模块（同步 API），无需原生编译。
 * 单文件存储，三层隔离。
 * 全文搜索用 LIKE（兼容所有 Node 版本的 SQLite 实现）。
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = process.env.MNEMONIC_DB_DIR || process.env.REASONIX_MEMORY_DB_DIR || join(__dirname, '..', 'data');
const DB_PATH = join(DB_DIR, 'memories.db');

let db = null;

export function getDb() {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  initSchema(db);
  return db;
}

function initSchema(db) {
  // 清理：旧版本遗留的 FTS 虚拟表和触发器（在所有 Node 版本中安全执行）
  try { db.exec('DROP TRIGGER IF EXISTS memories_ai'); } catch {}
  try { db.exec('DROP TRIGGER IF EXISTS memories_ad'); } catch {}
  try { db.exec('DROP TRIGGER IF EXISTS memories_au'); } catch {}
  try { db.exec('DROP TABLE IF EXISTS memories_fts'); } catch {}

  // 全量对话存储（设备迁移用，不在 UI 展示）
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      namespace TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      turn_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conv_session
      ON conversations(session_id, namespace);
    CREATE INDEX IF NOT EXISTS idx_conv_ns
      ON conversations(namespace, project);
    CREATE INDEX IF NOT EXISTS idx_conv_updated
      ON conversations(updated DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('global', 'namespace', 'project')),
      namespace TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '',
      access_count INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_scope
      ON memories(level, namespace, project);

    CREATE INDEX IF NOT EXISTS idx_memories_updated
      ON memories(updated DESC);
  `);
}

export function close() {
  if (db) {
    db.close();
    db = null;
  }
}
