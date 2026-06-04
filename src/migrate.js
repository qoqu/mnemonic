/**
 * mnemonic — Schema Migration System
 *
 * 版本化数据库迁移，确保跨版本升级安全。
 *
 * 设计原则：
 *   1. 每次新增/修改 schema 都加新 migration，不改旧的
 *   2. 所有 ALTER TABLE 先检查列/表是否存在
 *   3. 向前兼容，不破坏已有数据
 */

const SCHEMA_VERSION = 4; // 当前 schema 版本号
const VERSION_TABLE = 'schema_version';

// ── 迁移定义 ──────────────────────────────────────────────────────────

function hasTable(db, name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function hasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some(c => c.name === column);
}

function hasIndex(db, name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
}

const MIGRATIONS = {
  // v1: 初始 memories 表
  1: (db) => {
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
    `);
    if (!hasIndex(db, 'idx_memories_scope'))
      db.exec('CREATE INDEX idx_memories_scope ON memories(level, namespace, project)');
    if (!hasIndex(db, 'idx_memories_updated'))
      db.exec('CREATE INDEX idx_memories_updated ON memories(updated DESC)');
  },

  // v2: conversations + export_log
  2: (db) => {
    if (!hasTable(db, 'conversations')) {
      db.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
          namespace TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL, turn_count INTEGER NOT NULL DEFAULT 0,
          summary TEXT NOT NULL DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL
        );
      `);
    }
    if (!hasIndex(db, 'idx_conv_session'))
      db.exec('CREATE INDEX idx_conv_session ON conversations(session_id, namespace)');
    if (!hasIndex(db, 'idx_conv_ns'))
      db.exec('CREATE INDEX idx_conv_ns ON conversations(namespace, project)');
    if (!hasIndex(db, 'idx_conv_updated'))
      db.exec('CREATE INDEX idx_conv_updated ON conversations(updated DESC)');

    if (!hasTable(db, 'export_log')) {
      db.exec(`
        CREATE TABLE export_log (
          memory_id TEXT NOT NULL, project TEXT NOT NULL DEFAULT '',
          export_type TEXT NOT NULL DEFAULT 'summary', exported_at TEXT NOT NULL,
          PRIMARY KEY (memory_id, project, export_type)
        );
      `);
    }
    if (!hasIndex(db, 'idx_export_log_project'))
      db.exec('CREATE INDEX idx_export_log_project ON export_log(project, export_type)');
  },

  // v3: work_queue
  3: (db) => {
    if (!hasTable(db, 'work_queue')) {
      db.exec(`
        CREATE TABLE work_queue (
          id TEXT PRIMARY KEY, type TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','processing','completed','failed')),
          retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
    }
    if (!hasIndex(db, 'idx_wq_status'))
      db.exec('CREATE INDEX idx_wq_status ON work_queue(status)');
    if (!hasIndex(db, 'idx_wq_type'))
      db.exec('CREATE INDEX idx_wq_type ON work_queue(type, status)');
  },

  // v4: 清理旧 FTS 残留
  4: (db) => {
    try { db.exec('DROP TRIGGER IF EXISTS memories_ai'); } catch {}
    try { db.exec('DROP TRIGGER IF EXISTS memories_ad'); } catch {}
    try { db.exec('DROP TRIGGER IF EXISTS memories_au'); } catch {}
    try { db.exec('DROP TABLE IF EXISTS memories_fts'); } catch {}
  },
};

// ── 迁移执行器 ────────────────────────────────────────────────────────

/**
 * 运行所有待执行的迁移。在 getDb() 的 initSchema 中调用。
 */
export function runMigrations(db) {
  // 确保版本表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${VERSION_TABLE} (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  // 查询当前版本
  const row = db.prepare(`SELECT MAX(version) as v FROM ${VERSION_TABLE}`).get();
  const currentVersion = row && row.v ? row.v : 0;

  if (currentVersion >= SCHEMA_VERSION) {
    return; // 已是最新版本
  }

  // 按版本号顺序执行迁移
  const applied = [];
  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const migration = MIGRATIONS[v];
    if (!migration) {
      console.error(`[mnemonic] Migration ${v} not found, skipping`);
      continue;
    }

    // 事务包裹，保证原子性
    db.exec('BEGIN TRANSACTION');
    try {
      migration(db);
      db.prepare(`INSERT INTO ${VERSION_TABLE} (version, applied_at) VALUES (?, ?)`)
        .run(v, new Date().toISOString());
      db.exec('COMMIT');
      applied.push(v);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`[mnemonic] Migration ${v} failed: ${err.message}`);
      throw err; // 迁移失败，阻止启动
    }
  }

  if (applied.length > 0) {
    console.error(`[mnemonic] Schema migrated: v${currentVersion} → v${applied[applied.length - 1]}`);
  }
}

/**
 * 获取当前 schema 版本号（用于导出/诊断）。
 */
export function getVersion(db) {
  try {
    const row = db.prepare(`SELECT MAX(version) as v FROM ${VERSION_TABLE}`).get();
    return row && row.v ? row.v : 0;
  } catch {
    return 0;
  }
}
