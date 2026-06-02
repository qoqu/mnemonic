/**
 * mnemonic — 数据库层
 *
 * 使用 Node 22+ 内置 node:sqlite 模块（同步 API），无需原生编译。
 * 单文件存储 + FTS5 全文搜索。
 * 每条记忆带 level / namespace / project 三层隔离。
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

    -- FTS5 全文搜索
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, tags,
      content=memories, content_rowid=rowid,
      tokenize='unicode61'
    );

    -- 自动同步 FTS 的触发器
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.rowid, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.rowid, old.content, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags)
      VALUES ('delete', old.rowid, old.content, old.tags);
      INSERT INTO memories_fts(rowid, content, tags)
      VALUES (new.rowid, new.content, new.tags);
    END;
  `);
}

export function close() {
  if (db) {
    db.close();
    db = null;
  }
}
