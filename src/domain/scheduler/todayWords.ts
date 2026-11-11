/**
 * 今日新词（v0.4）—— 把「今天录入的词」随时再翻一遍。
 *
 * 定位：**只读回看，不是复习**。
 *
 * 为什么必须和「复习」分开：
 * 新词落库时已经结算过一次 Good（§5.5，due = 今天 + I₁），那是「录入即背过」的
 * 一次真实结算。若回看也走复习页，每翻一张就再结算一次，reps 会凭空翻倍、
 * 间隔被一次次推长 —— 词的到期日会因为你「多看了几眼」而漂移，排程就不再可信。
 *
 * 所以这条路只读：不写 review_logs、不动 fsrs_*、不写 sessions，
 * 也不计入首页的「今日到期」与会话统计。它在排程上的效果是零。
 *
 * 纯函数：只做切片与洗牌，不碰数据库、不碰 Date.now()。
 * 候选从哪来（created_at 落在今天）由 data 层按 dayRange 查好再传进来。
 */
import type { WordRow } from "../../data/types.ts";
import { shuffle } from "./session.ts";

export interface TodayWordsPick {
  /** 本轮要回看的词，已洗牌 */
  picked: WordRow[];
  /** 因为上限被顺延的数量 */
  deferred: number;
}

/**
 * 从「今天录入的词」里取前 limit 条并洗牌。
 *
 * 为什么排序键是录入先后（调用方已按 created_at 升序传进来）：
 * 今天录进去的顺序就是你今天背的顺序 —— 按它取前 N 条，等于「今天最先背的那些
 * 词优先回看」，和重新复习「取前 N 条」的取舍一致。
 *
 * 为什么不按别的字段排：这些词今天都只结算过一次，fsrs_reps 全是 1、
 * fsrs_lapses 全是 0、到期日也全是同一天 +1，任何「难度 / 稳定度 / 逾期」排序键
 * 在这里都退化成常数，排了等于没排。真正有意义的顺序只有录入先后这一个。
 *
 * 洗牌只为避免靠位置记忆：同一批词总以同样顺序出现，你会记住「第三张是哪个」
 * 而不是「第三张是什么意思」。洗的只是出场顺序，选哪些词不受影响。
 */
export function buildTodayWords(
  candidates: readonly WordRow[],
  limit: number,
  rng: () => number = Math.random,
): TodayWordsPick {
  const total = candidates.length;
  if (total === 0) return { picked: [], deferred: 0 };

  // 上限非法（NaN / 负数 / 0）时当作「没有上限」，而不是「一张都不看」——
  // 回看是零成本操作，看漏几张不如全看。这是刻意与 buildSession（limit = 0
  // 即不看）不同的取舍，与 buildRereview 保持一致。
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : total;
  const n = Math.min(safeLimit, total);
  return {
    picked: shuffle(candidates.slice(0, n), rng),
    deferred: total - n,
  };
}
