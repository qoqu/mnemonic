/**
 * mnemonic — Skeleton Renderer
 *
 * 从记忆内容中提取结构化骨架，类似 Ailoom 的骨架理念。
 * 纯启发式，不调用 AI。
 *
 * 骨架层次：
 *   Layer 0: snippet（传统摘要，向后兼容）
 *   Layer 1: topics + entities（关键主题和实体）
 *   Layer 2: relations + classification（关系网和类型归类）
 */

// ── 类型分类关键词 ──────────────────────────────────────────────────

const TYPE_KEYWORDS = {
  architecture: ['架构', '设计', '模式', '分层', '隔离', '体系', '结构', 'architecture', 'pattern', 'layer', 'arch'],
  decision: ['决定', '方案', '选择', '采用', '弃用', '结论', 'decision', 'choose', 'opt'],
  rule: ['规则', '规范', '约定', '原则', '标准', 'rule', 'convention', 'standard', 'guideline'],
  bugfix: ['修复', 'bug', '缺陷', 'issue', 'fix', 'patch', 'hotfix'],
  config: ['配置', '环境变量', 'env', 'config', 'setting', 'setup'],
  workflow: ['流程', '步骤', 'pipeline', 'workflow', '部署', '发布', 'ci'],
  insight: ['发现', '经验', '教训', 'insight', 'lesson', 'learned', 'note'],
};

function classifyType(content) {
  const scores = {};
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    scores[type] = keywords.filter(kw => content.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : 'general';
}

// ── 实体提取 ──────────────────────────────────────────────────────────

// 技术关键词，作为实体标记
const KNOWN_ENTITIES = [
  'SQLite', 'MCP', 'JSON', 'API', 'HTTP', 'SSE', 'REST', 'SQL', 'SHA', 'zlib',
  'base64', 'CLI', 'UI', 'DB', 'PID', 'WAL', 'JSONL', 'JSON-RPC',
  'Reasonix', 'mnemonic', 'Ailoom', 'claude-mem', 'Obsidian', 'GitHub',
  'Node', 'npm', 'Python', 'TypeScript', 'JavaScript',
];

function extractEntities(content) {
  const entities = [];
  // 提取已知技术词
  for (const kw of KNOWN_ENTITIES) {
    if (content.includes(kw)) entities.push(kw);
  }
  // 提取引号中的词
  const quoted = content.match(/[「『""]?([^「『""」』\s]{2,30})[」』""]?/g);
  if (quoted) {
    for (const q of quoted) {
      const clean = q.replace(/[「『""」』]/g, '');
      if (clean.length >= 2 && clean.length <= 30 && !entities.includes(clean)) {
        entities.push(clean);
      }
    }
  }
  return [...new Set(entities)].slice(0, 10);
}

// ── 主题提取 ──────────────────────────────────────────────────────────

function extractTopics(content) {
  const topics = [];
  // 匹配中英文关键模式
  const patterns = [
    /([^，。.!?]{2,30}方案[^，。.!?]{0,20})/g,
    /([^，。.!?]{2,30}架构[^，。.!?]{0,20})/g,
    /([^，。.!?]{2,30}机制[^，。.!?]{0,20})/g,
    /([^，。.!?]{2,30}模式[^，。.!?]{0,20})/g,
    /采用[了]?([^，。.!?]{2,20})/g,
    /使用[了]?([^，。.!?]{2,20})/g,
    /基于[了]?([^，。.!?]{2,20})/g,
    /通过[了]?([^，。.!?]{2,20})/g,
    /(\w+方案)/g,
    /(\w+架构)/g,
    /(\w+设计)/g,
    /(\w+模式)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const t = m[1].trim();
      if (t.length >= 4 && t.length <= 40 && !topics.includes(t)) {
        topics.push(t);
      }
    }
  }
  return topics.slice(0, 8);
}

// ── 关系提取 ──────────────────────────────────────────────────────────

// 已知项目名作为关系目标
const KNOWN_PROJECTS = [
  'mnemonic', 'zidu-novel-studio', 'novel-world-engine', 'UUMit',
  'DeepSeek-Reasonix', 'reasonix-buddy', 'Edge 插件', '个人知识库',
  'PlotPilot', 'Ailoom-Context', 'claude-mem',
];

function extractRelations(content) {
  const relations = [];
  for (const proj of KNOWN_PROJECTS) {
    if (content.includes(proj)) {
      // 判断关系类型
      const type = content.includes('替代') || content.includes('优于') ? '替代'
        : content.includes('依赖') || content.includes('基于') ? '依赖'
        : content.includes('对比') || content.includes('vs') ? '对比'
        : content.includes('融合') || content.includes('集成') ? '集成'
        : '引用';
      relations.push({ target: proj, type });
    }
  }
  return relations.slice(0, 6);
}

// ── 密度自适应 ────────────────────────────────────────────────────────

export function resolveDensity(content, budget) {
  if (!content) return 'minimal';
  const len = content.length;
  if (budget && budget < 100) return 'minimal';
  if (len > 500) return 'full';
  if (len > 200) return 'standard';
  return 'minimal';
}

// ── 主渲染函数 ────────────────────────────────────────────────────────

/**
 * 将一条记忆渲染为结构化骨架。
 *
 * @param {object} memory - 记忆对象 {id, content, level, importance, tags, project, created}
 * @param {object} options
 * @param {number} options.budget - 可用的 token 预算
 * @param {boolean} options.verbose - 是否返回完整骨架
 * @returns {object} 骨架对象
 */
export function renderSkeleton(memory, options = {}) {
  const content = memory.content || '';
  const density = resolveDensity(content, options.budget);

  // 基础骨架（始终包含）
  const skeleton = {
    id: memory.id,
    snippet: content.substring(0, 80) + (content.length > 80 ? '…' : ''),
    level: memory.level,
    importance: memory.importance || 'normal',
    project: memory.project,
    created: memory.created,
  };

  // 仅在非 minimal 密度时添加结构化字段
  if (density !== 'minimal') {
    const topics = extractTopics(content);
    const entities = extractEntities(content);
    const type = classifyType(content);

    skeleton.topics = topics;
    skeleton.entities = entities;
    skeleton.type = type;

    // full 密度时还添加关系和结构信息
    if (density === 'full') {
      const relations = extractRelations(content);
      if (relations.length > 0) skeleton.relations = relations;
    }
  }

  return skeleton;
}

/**
 * 批量渲染骨架。
 */
export function renderSkeletons(memories, options = {}) {
  if (!memories || memories.length === 0) return [];
  return memories.map(m => renderSkeleton(m, options));
}

/**
 * 估算骨架的 token 消耗。
 */
export function estimateSkeletonTokens(skeleton) {
  const json = JSON.stringify(skeleton);
  // 粗略：1 token ≈ 4 chars
  return Math.ceil(json.length / 4);
}
