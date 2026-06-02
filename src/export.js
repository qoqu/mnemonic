/**
 * mnemonic — export to knowledge base
 *
 * Reads memories from the store, maps them to KB directories,
 * writes markdown files with frontmatter to the inbox.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load mapping ──────────────────────────────────────────────────────

let _mapping = null;

function getMapping() {
  if (_mapping) return _mapping;
  const path = join(__dirname, '..', 'kb-mapping.json');
  if (existsSync(path)) {
    _mapping = JSON.parse(readFileSync(path, 'utf8'));
  } else {
    _mapping = {
      default_kb: 'memory',
      inbox: '📥',
      projects: {},
      tag_overrides: {},
    };
  }
  return _mapping;
}

// ── Resolve export target ─────────────────────────────────────────────

function resolveTarget(project, tags) {
  const mapping = getMapping();

  // Check tag overrides first
  if (tags && mapping.tag_overrides) {
    for (const tag of tags) {
      if (mapping.tag_overrides[tag]) return mapping.tag_overrides[tag];
    }
  }

  // Check project mapping
  if (mapping.projects[project]) return mapping.projects[project];

  // Default
  return { kb: mapping.default_kb || 'memory', type: 'fact' };
}

// ── Build frontmatter ─────────────────────────────────────────────────

function buildFrontmatter(mem, target, mapping) {
  // Determine mnemonic_type based on source
  let mnemonicType = 'manual_save';
  if (mem.source === 'tick' || (mem.tags && mem.tags.includes('session-log'))) {
    mnemonicType = 'summary';
  }
  if (mem.source === 'full_conversation') {
    mnemonicType = 'full_conversation';
  }

  return [
    '---',
    `type: ${target.type || 'fact'}`,
    `mnemonic_project: "${mem.project || ''}"`,
    `mnemonic_type: "${mnemonicType}"`,
    `created: ${mem.created ? mem.created.slice(0, 10) : new Date().toISOString().slice(0, 10)}`,
    `tags: [${(mem.tags || []).map(t => `"${t}"`).join(', ')}]`,
    `source: "${mem.source || ''}"`,
    '---',
    '',
    mem.content,
  ].join('\n');
}

// ── Main export ───────────────────────────────────────────────────────

export function exportToKb({ project, since, tags, dryRun, namespace }) {
  const mapping = getMapping();
  const inbox = mapping.inbox || '📥';

  // Determine KB vault path
  const vaultPath = process.env.MNEMONIC_KB_PATH;
  if (!vaultPath) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'MNEMONIC_KB_PATH not set. Point it to your Obsidian Vault root.',
        }),
      }],
      isError: true,
    };
  }

  // Query memories
  const query = store.search({
    query: '',
    levels: ['project', 'global', 'namespace'],
    namespace: namespace || 'default',
    project: project || '',
    limit: 500,
  });

  // Filter
  let filtered = query;
  if (since) {
    const sinceDate = new Date(since);
    filtered = filtered.filter(m => new Date(m.updated) >= sinceDate);
  }
  if (tags && tags.length > 0) {
    filtered = filtered.filter(m => {
      const memTags = m.tags || [];
      return tags.some(t => memTags.includes(t));
    });
  }

  if (filtered.length === 0) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ exported: 0, message: 'No memories matched' }) }],
    };
  }

  // Resolve target
  const target = resolveTarget(project, tags);

  // Build inbox path
  const inboxDir = join(vaultPath, inbox, target.kb);
  if (!existsSync(inboxDir)) {
    mkdirSync(inboxDir, { recursive: true });
  }

  if (dryRun) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          dry_run: true,
          matched: filtered.length,
          target: `${inbox}/${target.kb}/`,
          type: target.type,
          sample: filtered.slice(0, 3).map(m => ({
            content: m.content.substring(0, 80),
            tags: m.tags,
          })),
        }, null, 2),
      }],
    };
  }

  // Write files
  let written = 0;
  for (const mem of filtered) {
    const frontmatter = buildFrontmatter(mem, target, mapping);
    const slug = mem.content.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 40);
    const filename = `mnemonic_${mem.project || 'unknown'}_${slug}.md`;
    const filepath = join(inboxDir, filename);
    writeFileSync(filepath, frontmatter, 'utf8');
    written++;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        exported: written,
        target: `${inbox}/${target.kb}/`,
        type: target.type,
        project: project,
        inbox_path: inboxDir,
      }, null, 2),
    }],
  };
}
