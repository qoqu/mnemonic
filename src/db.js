/**
 * mnemonic — 数据库层
 *
 * 使用 Node 22+ 内置 node:sqlite 模块（同步 API），无需原生编译。
 * 单文件存储，三层隔离。
 * Schema 版本化，通过 migrate.js 管理。
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from './migrate.js';

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
  db.exec('PRAGMA busy_timeout = 5000');

  runMigrations(db);
  return db;
}

export function close() {
  if (db) {
    db.close();
    db = null;
  }
}
