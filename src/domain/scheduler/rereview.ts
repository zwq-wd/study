/**
 * 重新复习（v0.4）
 *
 * 定位：**再看一遍，不是再考一次**。
 *
 * 为什么必须「不结算」——
 * 复习页每结算一次 Again，FSRS 的 `lapses` 就 +1；而 `graduationOnLapses = 6`
 * 会把 lapses 达到 6 的词强制毕业（§5.6）。也就是说：一个词如果你今天反复
 * 「再过一遍」六次，它会被系统判定成「我认了」直接丢出队列 —— 越记不住的词
 * 反而越早消失，正好和备考的目的相反。
 *
 * 所以重新复习这条路**只读**：不写 `review_logs`、不推进 FSRS、不动 `sessions`。
 * 它在排程上的效果只有「多看了几眼」，下一次到期日仍然是原来那个 +1 天。
 *
 * 纯函数：时间与随机源都从参数进来，不碰数据库、不碰 Date.now()。
 */
import type { WordRow } from "../../data/types.ts";
import { shuffle } from "./session.ts";

export interface RereviewPick {
  /** 本轮要重看的词，已洗牌 */
  picked: WordRow[];
  /** 因为上限被顺延的数量 */
  deferred: number;
}

/**
 * 从「今天被标过背错了的词」里取前 limit 条并洗牌。
 *
 * 为什么不按错得多少排序：词表里没有「错了几次」这个可靠的排序键 ——
 * 一个词今天错一次和错三次，对「再看一遍」没有区别。
 * 洗牌保证每次打开顺序不同，避免靠位置记住。
 */
export function buildRereview(
  candidates: readonly WordRow[],
  limit: number,
  rng: () => number = Math.random,
): RereviewPick {
  const total = candidates.length;
  if (total === 0) return { picked: [], deferred: 0 };

  // 上限非法（NaN / 负数）时当作「没有上限」，而不是「一张都不看」——
  // 重新复习是零成本操作，看漏几张不如全看。
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : total;
  const n = Math.min(safeLimit, total);
  return {
    picked: shuffle(candidates.slice(0, n), rng),
    deferred: total - n,
  };
}
