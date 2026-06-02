#!/usr/bin/env node

/**
 * mnemonic — MCP memory manager
 *
 * 3-layer isolation (global / namespace / project),
 * shared across Hermes-Agent, OpenClaw, Claude Code, etc.
 *
 * Usage:
 *   node src/index.js                         # default namespace=default
 *   MNEMONIC_NAMESPACE=hermes node src/index.js
 *
 * Hermes / OpenClaw:
 *   mcp_servers:
 *     mnemonic:
 *       command: node path/to/mnemonic/src/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDb, close } from './db.js';
import { TOOLS, createHandlers } from './tools.js';

// ── Session 上下文 ───────────────────────────────────────────────────
const sessionContext = {
  namespace: process.env.MNEMONIC_NAMESPACE || process.env.REASONIX_MEMORY_NAMESPACE || 'default',
  project: process.env.MNEMONIC_PROJECT || process.env.REASONIX_MEMORY_PROJECT || '',
};
const getCtx = () => sessionContext;

// ── Server 初始化 ────────────────────────────────────────────────────
const server = new Server(
  { name: 'mnemonic', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const handlers = createHandlers(getCtx);

// ── listTools ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// ── callTool ──────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = handlers[name];
  if (!handler) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }
  try {
    return handler(args || {});
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// ── 启动 ─────────────────────────────────────────────────────────────
async function main() {
  getDb(); // 初始化数据库
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[mnemonic] started | ns=${sessionContext.namespace} proj=${sessionContext.project || '-'}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[mnemonic] fatal: ${err.message}\n`);
  close();
  process.exit(1);
});
