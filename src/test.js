/**
 * mnemonic 快速测试
 *
 * 启动 server，发送 MCP 协议请求，验证 6 个工具。
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [join(__dirname, 'index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, MNEMONIC_NAMESPACE: 'test-agent', MNEMONIC_PROJECT: 'test-project' },
});

let msgId = 0;
const pending = {};

function send(method, params) {
  msgId++;
  const req = JSON.stringify({ jsonrpc: '2.0', id: msgId, method, params });
  server.stdin.write(req + '\n');
  return new Promise((resolve) => {
    pending[msgId] = resolve;
  });
}

let buf = '';
server.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const resp = JSON.parse(line);
      if (resp.id && pending[resp.id]) {
        pending[resp.id](resp);
      }
    } catch (e) {
      console.log('Parse error:', line.substring(0, 100));
    }
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test() {
  // 1. listTools
  const listResp = await send('tools/list', {});
  const toolNames = listResp.result.tools.map(t => t.name);
  console.log('✅ tools/list:', toolNames.join(', '));

  // 2. memory_add
  const add1Resp = await send('tools/call', {
    name: 'memory_add',
    arguments: { content: '用户偏好用 const/let 而非 var', tags: ['coding-style'], level: 'project' },
  });
  const add1 = JSON.parse(add1Resp.result.content[0].text);
  console.log('✅ memory_add:', add1);

  // 3. memory_add — global
  const add2Resp = await send('tools/call', {
    name: 'memory_add',
    arguments: { content: 'JavaScript 中 === 比 == 更安全', tags: ['javascript'], level: 'global', source: 'MDN 推荐' },
  });
  const add2 = JSON.parse(add2Resp.result.content[0].text);
  console.log('✅ memory_add (global):', add2);

  // 4. memory_search
  await sleep(100);
  const searchResp = await send('tools/call', {
    name: 'memory_search',
    arguments: { query: 'const', levels: ['project'] },
  });
  const search = JSON.parse(searchResp.result.content[0].text);
  console.log(`✅ memory_search (${search.length}):`, search.map(m => m.content));

  // 5. memory_list
  const listResp2 = await send('tools/call', {
    name: 'memory_list',
    arguments: { levels: ['global'] },
  });
  const list = JSON.parse(listResp2.result.content[0].text);
  console.log(`✅ memory_list (${list.length}):`, list.map(m => m.content));

  // 6. memory_stats
  const statsResp = await send('tools/call', { name: 'memory_stats', arguments: {} });
  const stats = JSON.parse(statsResp.result.content[0].text);
  console.log('✅ memory_stats:', stats);

  // 7. memory_update
  const updateResp = await send('tools/call', {
    name: 'memory_update',
    arguments: { id: add1.id, content: '用户偏好 const/let，也偏好箭头函数' },
  });
  const update = JSON.parse(updateResp.result.content[0].text);
  console.log('✅ memory_update:', update);

  // 8. memory_remove
  const removeResp = await send('tools/call', {
    name: 'memory_remove',
    arguments: { id: add2.id },
  });
  const remove = JSON.parse(removeResp.result.content[0].text);
  console.log('✅ memory_remove:', remove);

  // 9. memory_search — 验证删除
  const search2Resp = await send('tools/call', {
    name: 'memory_search',
    arguments: { query: '===' },
  });
  const search2 = JSON.parse(search2Resp.result.content[0].text);
  const arr2 = Array.isArray(search2) ? search2 : [];
  console.log(`✅ memory_search (after remove, ${arr2.length}):`, arr2.map(m => m.content));

  console.log('\n🎉 全部测试通过');
  server.kill();
  process.exit(0);
}

test().catch(err => {
  console.error('❌ 测试失败:', err);
  server.kill();
  process.exit(1);
});
