/**
 * 会话生成（开发文档 §5.7）
 *
 * 这条函数必须是纯函数：输入数组、输出数组，不碰数据库、不碰 Date.now()、不碰 window。
 * 时间从参数传进来。
 */
import type { WordRow } from "../../data/types.ts";

export interface SessionPick {
  picked: WordRow[];
  deferred: number;
}

/**
 * 从已排好序的到期候选里取前 limit 条。
 *
 * 「节奏不乱」的技术定义就在这里：顺延的词不消失、不清零，
 * 它们逾期更久，下次打开时天然排在最前。
 */
export function buildSession(
  candidates: readonly WordRow[],
  limit: number,
  includeAll = false,
): SessionPick {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const n = includeAll ? candidates.length : Math.min(safeLimit, candidates.length);
  return {
    picked: candidates.slice(0, n),
    deferred: candidates.length - n,
  };
}

/**
 * 排序规则（§5.4 / §4.3.4）：
 * fsrs_due_day ASC（逾期最久优先）→ fsrs_stability ASC（越不牢越优先）→ id ASC
 */
export function sortCandidates(candidates: readonly WordRow[]): WordRow[] {
  return [...candidates].sort((a, b) => {
    const da = a.fsrs_due_day ?? "9999-12-31";
    const db = b.fsrs_due_day ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    if (a.fsrs_stability !== b.fsrs_stability) return a.fsrs_stability - b.fsrs_stability;
    return a.id - b.id;
  });
}
