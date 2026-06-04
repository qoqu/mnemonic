/**
 * mnemonic — Health Check & Self-Healing
 *
 * 启动时检查数据库完整性，自动修复可修复的问题。
 *
 * 检查项：
 *   1. SQLite integrity_check
 *   2. 卡在 processing 的工作项（进程崩溃残留）
 *   3. 孤立的外键引用
 *   4. Schema 版本是否匹配
 *   5. 长期未清理的已完成/失败任务
 */

import { getDb, close } from './db.js';

// ── 检查函数 ──────────────────────────────────────────────────────────

function checkIntegrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  const errors = rows.filter(r => r.integrity_check !== 'ok');
  return {
    pass: errors.length === 0,
    detail: errors.length === 0 ? 'ok' : errors.map(e => e.integrity_check).join('; '),
  };
}

function checkOrphanedProcessing(db, fix) {
  const orphans = db.prepare("SELECT COUNT(*) as c FROM work_queue WHERE status = 'processing'").get().c;
  if (orphans > 0 && fix) {
    const ts = new Date().toISOString();
    db.prepare("UPDATE work_queue SET status = 'pending', updated_at = ? WHERE status = 'processing'").run(ts);
  }
  return {
    pass: orphans === 0,
    detail: orphans > 0 ? `${orphans} items stuck in processing` : 'ok',
    fixed: orphans > 0 && fix ? orphans : 0,
  };
}

function checkSchemaVersion(db) {
  try {
    const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
    const ver = row && row.v ? row.v : 0;
    return { pass: ver > 0, detail: `schema v${ver}` };
  } catch {
    return { pass: false, detail: 'schema_version table missing (fresh DB?)' };
  }
}

function checkStaleWork(db, fix) {
  const stale = db.prepare(
    "SELECT COUNT(*) as c FROM work_queue WHERE status IN ('completed','failed') AND updated_at < datetime('now', '-7 days')"
  ).get().c;
  if (stale > 0 && fix) {
    db.prepare(
      "DELETE FROM work_queue WHERE status IN ('completed','failed') AND updated_at < datetime('now', '-7 days')"
    ).run();
  }
  return {
    pass: stale === 0,
    detail: stale > 0 ? `${stale} stale items older than 7 days` : 'ok',
    fixed: stale > 0 && fix ? stale : 0,
  };
}

function checkTablePresence(db) {
  const expected = ['memories', 'conversations', 'work_queue', 'export_log', 'schema_version'];
  const missing = expected.filter(name => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
    return !row;
  });
  return { pass: missing.length === 0, detail: missing.length > 0 ? `missing: ${missing.join(', ')}` : 'ok' };
}

// ── 主入口 ────────────────────────────────────────────────────────────

/**
 * 运行健康检查。autoFix 为 true 时自动修复可修复的问题。
 * 返回检查报告。
 */
export function healthCheck({ autoFix = true } = {}) {
  const results = {};
  let db;

  try {
    db = getDb();
  } catch (err) {
    return {
      pass: false,
      summary: `Database connection failed: ${err.message}`,
      checks: { connect: { pass: false, detail: err.message } },
      fixed: { items: 0 },
    };
  }

  // 逐项检查
  results.integrity = checkIntegrity(db);
  results.schema = checkSchemaVersion(db);
  results.tables = checkTablePresence(db);
  results.orphans = checkOrphanedProcessing(db, autoFix);
  results.stale = checkStaleWork(db, autoFix);

  // 统计
  const allPass = Object.values(results).every(r => r.pass);
  const totalFixed = Object.values(results).reduce((sum, r) => sum + (r.fixed || 0), 0);

  return {
    pass: allPass,
    summary: allPass ? 'All checks passed' : `${Object.values(results).filter(r => !r.pass).length} check(s) failed`,
    checks: results,
    fixed: { items: totalFixed },
  };
}

/**
 * 在启动时调用。如果不通过则打印警告但不阻止启动。
 */
export function startupHealthCheck() {
  const report = healthCheck({ autoFix: true });

  if (!report.pass) {
    const failures = Object.entries(report.checks)
      .filter(([_, c]) => !c.pass)
      .map(([name, c]) => `  ${name}: ${c.detail}`);
    // stderr 输出不会污染 MCP 协议
    process.stderr.write(`[mnemonic] Health: ${failures.length} issue(s)\n`);
    for (const f of failures) process.stderr.write(`[mnemonic]   ${f}\n`);
  }

  if (report.fixed.items > 0) {
    process.stderr.write(`[mnemonic] Health: fixed ${report.fixed.items} item(s)\n`);
  }

  return report;
}
