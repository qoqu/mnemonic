/**
 * mnemonic — MCP IO Discipline
 *
 * 确保 stdio 模式下 MCP JSON-RPC 协议不被第三方库的 stderr 噪声污染。
 *
 * 设计：
 *   安装 stderr 缓冲 → 执行期间所有日志进缓冲区
 *   成功 → 丢弃缓冲，静默退出
 *   失败 → 冲刷缓冲到 stderr，退出并报错
 */

// ── 状态 ──────────────────────────────────────────────────────────────

let _realStderrWrite = null;
let _buffer = null;
let _installed = false;

// ── Bypass 通道（绕过缓冲直接写 stderr） ─────────────────────────────

function bypassWrite(chunk) {
  const writer = _realStderrWrite || process.stderr.write.bind(process.stderr);
  return writer(chunk);
}

// ── 安装缓冲 ─────────────────────────────────────────────────────────

export function installStderrBuffer() {
  if (_installed) return null;

  _realStderrWrite = process.stderr.write.bind(process.stderr);
  _buffer = [];
  _installed = true;

  process.stderr.write = (chunk) => {
    if (_buffer !== null) {
      _buffer.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
    }
    return true;
  };

  return {
    flush() { if (_buffer && _buffer.length > 0) { _realStderrWrite(_buffer.join('')); _buffer = []; } },
    drop() { _buffer = []; },
    restore() { if (_installed) { process.stderr.write = _realStderrWrite; _installed = false; _buffer = null; _realStderrWrite = null; } },
  };
}

// ── emit 函数 ─────────────────────────────────────────────────────────

/**
 * 诊断日志：直接写 stderr（绕过缓冲）。用于 operator 可见的日志。
 */
export function emitDiagnostic(msg) {
  bypassWrite(msg.endsWith('\n') ? msg : `${msg}\n`);
}

/**
 * MCP JSON-RPC 输出：写 stdout（数据通道）。
 */
export function emitResult(jsonObj) {
  const line = JSON.stringify(jsonObj) + '\n';
  // MCP 协议要求 stdout 仅用于 JSON-RPC 消息，写入不能加额外内容
  // console.log 会自动加换行，但 buffer flush 可能干扰
  process.stdout.write(line);
}

/**
 * 错误报告：冲刷缓冲，然后写错误到 stderr。
 */
export function emitBlockingError(msg) {
  // 先冲刷缓冲
  if (_buffer && _buffer.length > 0) {
    bypassWrite(_buffer.join(''));
    _buffer = [];
  }
  bypassWrite(msg.endsWith('\n') ? msg : `${msg}\n`);
}

/**
 * 正常退出：丢弃缓冲，进程退出。
 */
export function exitGraceful(code = 0) {
  if (_buffer) _buffer = [];
  process.exit(code);
}

/**
 * 重置状态（用于测试和重启）。
 */
export function reset() {
  if (_installed) {
    process.stderr.write = _realStderrWrite;
    _installed = false;
  }
  _buffer = null;
  _realStderrWrite = null;
}
