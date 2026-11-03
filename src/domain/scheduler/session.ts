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
 * 从已排好序的到期候选里取前 limit 条，然后把**出场顺序**打乱。
 *
 * 两件事必须分开看：
 *   - 「选哪些词」按 §5.4 排序取前 N —— 逾期最久的优先进来，这条不能被随机破坏，
 *     否则顺延的词可能长期轮不到。
 *   - 「先看哪张」与排程无关 —— 按逾期顺序一连看 150 张，你会靠位置而不是靠记忆
 *     记住下一张是什么，且同一批词每次都以同样顺序出现。所以取完再洗牌。
 *
 * 「节奏不乱」的技术定义没变：顺延的词不消失、不清零，它们逾期更久，
 * 下次打开时天然排在最前（洗的只是这一轮内部的顺序）。
 *
 * rng 可注入，默认 Math.random —— 纯函数层不碰时间，但随机源要能固定，测试才能断言。
 */
export function buildSession(
  candidates: readonly WordRow[],
  limit: number,
  includeAll = false,
  rng: () => number = Math.random,
): SessionPick {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const n = includeAll ? candidates.length : Math.min(safeLimit, candidates.length);
  return {
    picked: shuffle(candidates.slice(0, n), rng),
    deferred: candidates.length - n,
  };
}

/** Fisher–Yates。返回新数组，不改入参。 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // noUncheckedIndexedAccess：两个下标都判空，虽然 i/j 由循环保证在范围内
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
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
