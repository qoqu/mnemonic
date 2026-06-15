#!/usr/bin/env node

/**
 * mnemonic — Watchdog
 *
 * 进程守护 + 健康检查 + 自动重启。
 *
 * 用法：
 *   node watchdog.js
 *
 * 环境变量：
 *   MNEMONIC_PORT     — MCP 端口（默认 3457）
 *   MNEMONIC_DB_DIR   — 数据库目录（默认 ./data）
 *   MNEMONIC_NAMESPACE— Agent 命名空间（默认 default）
 *   MNEMONIC_SYNC_DIR — 同步盘备份目录（可选）
 *   MNEMONIC_WATCH_INTERVAL — 健康检查间隔秒数（默认 30）
 *
 * 行为：
 *   1. 以子进程启动 mnemonic
 *   2. 每 N 秒检查一次 HTTP 健康端点
 *   3. 子进程崩溃或挂起 → 自动重启
 *   4. 按 Ctrl+C 时优雅关闭子进程
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.MNEMONIC_PORT || '3457', 10);
const DB_DIR = process.env.MNEMONIC_DB_DIR || path.join(__dirname, 'data');
const NS = process.env.MNEMONIC_NAMESPACE || 'default';
const SYNC_DIR = process.env.MNEMONIC_SYNC_DIR || '';
const INTERVAL = parseInt(process.env.MNEMONIC_WATCH_INTERVAL || '30', 10) * 1000;

let child = null;
let stopping = false;

// ── 启动 mnemonic ────────────────────────────────────────────────────

function startMnemonic() {
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }

  const env = {
    ...process.env,
    MNEMONIC_PORT: String(PORT),
    MNEMONIC_NAMESPACE: NS,
    MNEMONIC_DB_DIR: DB_DIR,
  };
  if (SYNC_DIR) env.MNEMONIC_SYNC_DIR = SYNC_DIR;

  child = spawn(process.execPath, [path.join(__dirname, 'src', 'index.js')], {
    env,
    stdio: 'inherit',
    detached: false,
    windowsHide: true,
  });

  console.log(`[watchdog] mnemonic started (pid=${child.pid}, port=${PORT})`);

  child.on('exit', (code) => {
    if (stopping) return;
    console.log(`[watchdog] mnemonic exited (code=${code}), restarting in 3s...`);
    setTimeout(startMnemonic, 3000);
  });
}

// ── 健康检查 ──────────────────────────────────────────────────────────

function checkHealth() {
  if (stopping || !child) return;
  const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const ok = JSON.parse(data).status === 'ok';
        if (!ok) restart('health check failed');
      } catch { restart('health response invalid'); }
    });
  });
  req.on('error', () => restart('health check error'));
  req.setTimeout(5000, () => { req.destroy(); restart('health timeout'); });
}

function restart(reason) {
  if (stopping || !child) return;
  console.log(`[watchdog] ${reason}, restarting...`);
  try { child.kill(); } catch {}
  child = null;
  setTimeout(startMnemonic, 2000);
}

// ── 启动时先等端口释放 ────────────────────────────────────────────────

function waitForPort(done) {
  const tryConnect = () => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, () => {
      // 端口还有进程 → 等一会
      req.destroy();
      setTimeout(tryConnect, 2000);
    });
    req.on('error', () => done());  // 端口空闲 → 可以启动了
    req.setTimeout(2000, () => { req.destroy(); setTimeout(tryConnect, 2000); });
  };
  tryConnect();
}

// ── 启动流程 ──────────────────────────────────────────────────────────

console.log(`[watchdog] starting mnemonic on port ${PORT}...`);
console.log(`[watchdog] db=${DB_DIR} sync=${SYNC_DIR || '-'}`);

waitForPort(() => {
  startMnemonic();
  // 启动后等一会再开始健康检查
  setTimeout(() => {
    if (!stopping) setInterval(checkHealth, INTERVAL);
  }, 5000);
});

// ── 优雅关闭 ──────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  stopping = true;
  console.log('\n[watchdog] shutting down...');
  if (child) {
    child.on('exit', () => process.exit(0));
    child.kill('SIGTERM');
    setTimeout(() => process.exit(1), 5000);
  } else {
    process.exit(0);
  }
});
