/**
 * mnemonic — Token Budget Utility
 *
 * 估算 token 消耗，按预算截断结果。
 *
 * 估算规则（粗糙但实用）：
 *   中文：~1.5 chars/token（汉字约 1.8，标点约 0.5）
 *   英文：~4 chars/token
 *   混合：取加权平均
 */

// ── Token 估算 ───────────────────────────────────────────────────────

function isChinese(char) {
  return char >= '\u4e00' && char <= '\u9fff';
}

export function estimateTokens(text) {
  if (!text) return 0;
  let chineseCount = 0;
  let otherCount = 0;
  for (const char of text) {
    if (isChinese(char)) chineseCount++;
    else otherCount++;
  }
  // 中文：1 char ≈ 0.55 token，英文：1 char ≈ 0.25 token
  return Math.ceil(chineseCount * 0.6 + otherCount * 0.28);
}

// ── 按预算截断 ────────────────────────────────────────────────────────

/**
 * 从 items 中依次取出条目，直到累计 token 超过 budget。
 * 每个条目的 token 由 extractText(item) 返回的文本长度估算。
 */
export function truncateByBudget(items, budget, extractText = (item) => item.content || '') {
  if (!budget || budget <= 0) return items;
  if (!items || items.length === 0) return [];

  const result = [];
  let totalTokens = 0;

  // 先算每条的开销，排序后贪婪选择
  const costed = items.map(item => ({
    item,
    text: extractText(item),
    tokens: estimateTokens(extractText(item)) + 10, // 每条额外加 JSON 开销
  }));

  for (const c of costed) {
    if (totalTokens + c.tokens > budget) break;
    result.push(c.item);
    totalTokens += c.tokens;
  }

  return result;
}

// ── 给 memory_map 加 budget 信息 ──────────────────────────────────────

/**
 * 给返回结果加上预算信息。
 */
export function withBudgetInfo(result, budget) {
  if (!budget) return result;
  return {
    ...result,
    _budget: {
      limit: budget,
      returned: Array.isArray(result) ? result.length : (result.length || 0),
    },
  };
}
