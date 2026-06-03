#!/usr/bin/env node

/**
 * mnemonic — MCP memory manager
 *
 * 3-layer isolation (global / namespace / project),
 * shared across Hermes-Agent, OpenClaw, Claude Code, etc.
 *
 * Dual-mode transport + admin UI (HTTP mode only):
 *   stdio (default)  — single machine
 *   MNEMONIC_PORT    — HTTP/SSE + admin UI at http://localhost:PORT/
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb, close } from './db.js';
import { TOOLS, createHandlers } from './tools.js';
import { exportToKb } from './export.js';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true };
  }
  try { return handler(args || {}); }
  catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true }; }
});

// ── SSEServerTransport 池 ────────────────────────────────────────────

const transports = new Map();

// ── JSON response helpers ────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Admin HTML ────────────────────────────────────────────────────────

const ADMIN_HTML_PATH = join(__dirname, 'admin.html');
let adminHtml = '';

function loadAdminHtml() {
  if (existsSync(ADMIN_HTML_PATH)) {
    adminHtml = readFileSync(ADMIN_HTML_PATH, 'utf8');
  }
}

// ── REST API routes ───────────────────────────────────────────────────

function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  const searchParams = url.searchParams;

  // GET /api/memories — search / list
  if (method === 'GET' && pathname === '/api/memories') {
    const memories = store.search({
      query: searchParams.get('query') || '',
      levels: searchParams.get('levels') ? searchParams.get('levels').split(',') : undefined,
      namespace: searchParams.get('namespace') || undefined,
      project: searchParams.get('project') || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
    });
    return json(res, memories);
  }

  // GET /api/stats
  if (method === 'GET' && pathname === '/api/stats') {
    return json(res, store.stats());
  }

  // POST /api/memories — add
  if (method === 'POST' && pathname === '/api/memories') {
    readBody(req).then(body => {
      const result = store.add({
        content: body.content,
        level: body.level || 'auto',
        namespace: body.namespace || sessionContext.namespace,
        project: body.project || sessionContext.project || '',
        tags: body.tags,
        source: body.source || '',
      });
      json(res, result, 201);
    }).catch(err => json(res, { error: err.message }, 400));
    return;
  }

  // POST /api/log — session tick (lightweight, namespace-level, auto-tagged "session-log")
  if (method === 'POST' && pathname === '/api/log') {
    readBody(req).then(body => {
      const tags = ['session-log', body.status || 'idle'];
      const content = `[${body.status || 'idle'}] ${body.context}`;
      const result = store.add({
        content,
        level: 'namespace',
        namespace: sessionContext.namespace,
        project: body.project || sessionContext.project || '',
        tags,
        source: 'tick',
      });
      json(res, { id: result.id, logged: true }, 201);
    }).catch(err => json(res, { error: err.message }, 400));
    return;
  }

  // PUT /api/memories/:id — update (supports content, tags, source, level, project)
  const putMatch = pathname.match(/^\/api\/memories\/(.+)$/);
  if (method === 'PUT' && putMatch) {
    const id = putMatch[1];
    readBody(req).then(body => {
      const result = store.update({
        id, content: body.content, tags: body.tags,
        source: body.source, level: body.level, project: body.project,
      });
      json(res, result);
    }).catch(err => json(res, { error: err.message }, 400));
    return;
  }

  // DELETE /api/memories/:id — delete
  const delMatch = pathname.match(/^\/api\/memories\/(.+)$/);
  if (method === 'DELETE' && delMatch) {
    const result = store.remove({ id: delMatch[1] });
    json(res, result);
    return;
  }

  // ── 设备迁移：全量对话 REST API ─────────────────────────────────
  // GET /api/conversations?namespace=&project=&limit= — list
  if (method === 'GET' && pathname === '/api/conversations') {
    const result = store.convList({
      namespace: searchParams.get('namespace') || sessionContext.namespace,
      project: searchParams.get('project') || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
    });
    return json(res, result);
  }

  // POST /api/conversations — save
  if (method === 'POST' && pathname === '/api/conversations') {
    readBody(req).then(body => {
      const result = store.convSave({
        session_id: body.session_id,
        namespace: body.namespace || sessionContext.namespace,
        project: body.project || sessionContext.project || '',
        content: body.content,
        turn_count: body.turn_count || 0,
        summary: body.summary || '',
      });
      json(res, result, 201);
    }).catch(err => json(res, { error: err.message }, 400));
    return;
  }

  // GET /api/conversations/:session_id — get full content
  const convGetMatch = pathname.match(/^\/api\/conversations\/(.+)$/);
  if (method === 'GET' && convGetMatch) {
    const result = store.convGet(convGetMatch[1]);
    if (!result) { return json(res, { error: 'Not found' }, 404); }
    return json(res, result);
  }

  // DELETE /api/conversations/:session_id — remove
  if (method === 'DELETE' && convGetMatch) {
    const result = store.convDelete(convGetMatch[1]);
    return json(res, result);
  }

  // GET /api/export?project=&since=&tags=&type=&dry_run= — export to KB
  if (method === 'GET' && pathname === '/api/export') {
    const result = exportToKb({
      project: searchParams.get('project') || sessionContext.project,
      since: searchParams.get('since') || undefined,
      tags: searchParams.get('tags') ? searchParams.get('tags').split(',') : undefined,
      type: searchParams.get('type') || 'summary',
      dryRun: searchParams.get('dry_run') === 'true',
      namespace: sessionContext.namespace,
    });
    // exportToKb returns MCP format, extract the JSON text
    try {
      const text = result.content[0].text;
      json(res, JSON.parse(text));
    } catch {
      json(res, result);
    }
    return;
  }

  json(res, { error: 'Not found' }, 404);
}

// ── HTTP Server ──────────────────────────────────────────────────────

function startHttpMode() {
  loadAdminHtml();

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Admin UI
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      if (adminHtml) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(adminHtml);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Admin UI not found (admin.html missing). Run from the mnemonic project root.');
      }
      return;
    }

    // REST API
    if (pathname.startsWith('/api/')) {
      return handleApi(req, res, url);
    }

    // SSE endpoint
    if (req.method === 'GET' && pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => transports.delete(transport.sessionId));
      server.connect(transport).catch(err => process.stderr.write(`[mnemonic] SSE error: ${err.message}\n`));
      return;
    }

    // Health
    if (req.method === 'GET' && pathname === '/health') {
      return json(res, {
        status: 'ok',
        namespace: sessionContext.namespace,
        project: sessionContext.project || null,
        transports: transports.size,
      });
    }

    // Message
    if (req.method === 'POST' && pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = sessionId ? transports.get(sessionId) : null;
      if (!transport) { return json(res, { error: 'Session not found' }, 404); }
      readBody(req).then(parsed => {
        transport.handlePostMessage(req, res, parsed);
      }).catch(err => json(res, { error: err.message }, 400));
      return;
    }

    json(res, { error: 'Not found' }, 404);
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
  process.stderr.write(`[mnemonic] stdio mode | ns=${sessionContext.namespace} proj=${sessionContext.project || '-'}\n`);
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  getDb();
  if (PORT > 0) { startHttpMode(); }
  else { startStdioMode().catch(err => { process.stderr.write(`[mnemonic] fatal: ${err.message}\n`); close(); process.exit(1); }); }
}

main();
