/**
 * mnemonic — Sync Heartbeat
 *
 * 周期性将数据库备份到同步盘，解决同步盘无法读取锁定文件的问题。
 *
 * 每 N 秒执行一次 checkpoint，将数据库快照写入同步盘目录。
 */

import { getDb } from './db.js';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { emitDiagnostic } from './io-discipline.js';

let _timer = null;
let _lastSize = 0;

/**
 * 启动同步心跳。
 * @param {string} syncDir - 同步盘上的备份目录
 * @param {number} intervalSec - 备份间隔（秒），默认 300（5分钟）
 */
export function startSyncHeartbeat(syncDir, intervalSec = 300) {
  if (!syncDir) return;
  if (!existsSync(syncDir)) mkdirSync(syncDir, { recursive: true });

  // 先做一次
  doBackup(syncDir);

  // 定时做
  _timer = setInterval(() => doBackup(syncDir), intervalSec * 1000);
  if (_timer.unref) _timer.unref(); // 不阻止进程退出

  emitDiagnostic(`[mnemonic] Sync heartbeat started → ${syncDir} every ${intervalSec}s`);
}

function doBackup(syncDir) {
  try {
    const db = getDb();
    const dbPath = db.name; // 当前数据库文件路径

    // 检查文件是否有变化（避免不必要的复制）
    let currentSize;
    try { currentSize = statSync(dbPath).size; } catch { return; }
    if (currentSize === _lastSize) return; // 无变化，跳过
    _lastSize = currentSize;

    // WAL checkpoint：将 WAL 内容刷入主文件
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    // 复制到同步盘
    const dest = join(syncDir, 'memories.db');
    copyFileSync(dbPath, dest);

    // 同时复制 WAL 和 SHM 文件（如果存在）
    for (const ext of ['-wal', '-shm']) {
      try {
        const src = dbPath + ext;
        const dst = dest + ext;
        if (existsSync(src)) copyFileSync(src, dst);
      } catch {}
    }
  } catch (err) {
    emitDiagnostic(`[mnemonic] Sync heartbeat backup failed: ${err.message.substring(0, 80)}`);
  }
}

/**
 * 停止同步心跳。
 */
export function stopSyncHeartbeat() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
