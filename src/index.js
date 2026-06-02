#!/usr/bin/env node

/**
 * mnemonic — MCP memory manager
 *
 * 3-layer isolation (global / namespace / project),
 * shared across Hermes-Agent, OpenClaw, Claude Code, etc.
 *
 * Dual-mode transport:
 *   stdio (default) — single machine, MCP host spawns the process
 *   HTTP/SSE        — cross-device, set MNEMONIC_PORT=3456
 *
 * Usage:
 *   node src/index.js                          # stdio, namespace=default
 *   MNEMONIC_NAMESPACE=hermes node src/index.js
 *   MNEMONIC_PORT=3456 node src/index.js       # HTTP mode on port 3456
 *   MNEMONIC_PORT=3456 MNEMONIC_NAMESPACE=hermes node src/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { getDb, close } from './db.js';
import { TOOLS, createHandlers } from './tools.js';

// ── Config ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.MNEMONIC_PORT || '', 10);
const sessionContext = {
  namespace: process.env.MNEMONIC_NAMESPACE || process.env.REASONIX_MEMORY_NAMESPACE || 'default',
  project: process.env.MNEMONIC_PROJECT || process.env.REASONIX_MEMORY_PROJECT || '',
};
const getCtx = () => sessionContext;

// ── MCP Server ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mnemonic', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const handlers = createHandlers(getCtx);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

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

// ── SSEServerTransport 池 ────────────────────────────────────────────
// 每个 SSE 连接有一个 transport，按 sessionId 索引
const transports = new Map();

// ── HTTP / SSE mode ──────────────────────────────────────────────────

function startHttpMode() {
  const httpServer = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── SSE endpoint ──────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });

      server.connect(transport).catch(err => {
        process.stderr.write(`[mnemonic] SSE connect error: ${err.message}\n`);
      });
      return;
    }

    // ── Health check ─────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        namespace: sessionContext.namespace,
        project: sessionContext.project || null,
        transports: transports.size,
      }));
      return;
    }

    // ── Message endpoint (POST /message?sessionId=xxx) ──────
    if (req.method === 'POST' && pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? transports.get(sessionId) : null;

      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        transport.handlePostMessage(req, res, parsed);
      });
      return;
    }

    // ── Fallback ─────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use GET /sse, POST /message, or GET /health' }));
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    process.stderr.write(
      `[mnemonic] HTTP mode on http://0.0.0.0:${PORT} | ns=${sessionContext.namespace} proj=${sessionContext.project || '-'}\n`,
    );
  });
}

// ── Stdio mode ────────────────────────────────────────────────────────

async function startStdioMode() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[mnemonic] stdio mode | ns=${sessionContext.namespace} proj=${sessionContext.project || '-'}\n`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  getDb(); // init DB

  if (PORT > 0) {
    startHttpMode();
  } else {
    startStdioMode().catch((err) => {
      process.stderr.write(`[mnemonic] fatal: ${err.message}\n`);
      close();
      process.exit(1);
    });
  }
}

main();
