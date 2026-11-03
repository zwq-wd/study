/**
 * 本轮重排（v0.4）—— 背错了的词在本轮里再做一遍，直到背对。
 *
 * 为什么不能「每次背错都结算一次」：
 * 复习页每结算一次 Again，`lapses` 就 +1；而 `graduationOnLapses = 6` 会把
 * lapses 到 6 的词强制毕业（§5.6）。若本轮每出现一次就结算一次，一个词只要
 * 在这一次坐里错 6 次，就会被永久移出队列 —— **最需要练的词反而最先消失**。
 * 实测：一个词本轮错 4 次后 S 从 2.31 掉到 0.02，再错 2 次就强制毕业。
 *
 * 所以规则是：
 *   - **同一张卡本轮只结算第一次**（第一次反应才是真实的第一印象）
 *   - 之后每次重新出现都只是「再练一遍」，不写库、不动 FSRS
 *   - 背对即退出本轮重排；明天按第一次的 Again 正常复习（due = +1 天）
 *
 * 纯函数：随机源从参数进来，不碰数据库、不碰 Date.now()。
 */
import { Rating } from "ts-fsrs";
import type { WordRow } from "../../data/types.ts";

/**
 * 一张卡本轮最多重排几次。
 *
 * 不设上限会让一个死活记不住的词把整场会话拖成无限循环。
 * 3 次（连同首次共看 4 遍）之后停止重排：再坐着重复同一张已经不再提高留存，
 * 它的 Again 已经记在库里，明天自然会再排到。
 */
export const MAX_REQUEUE_PER_CARD = 3;

/** 重排的词至少要隔几张再出现 —— 紧接着出现是「熟面孔」而不是回忆。 */
export const MIN_REQUEUE_GAP = 5;

export interface RequeueDecision {
  requeue: boolean;
  /** ok = 重新排入；recalled = 背对了不该再排；exhausted = 本轮次数用尽 */
  reason: "ok" | "recalled" | "exhausted";
}

/**
 * 这次评分之后要不要把词重新排回本轮队列。
 *
 * @param rating 本次评分
 * @param requeuedSoFar 这个词本轮已经被重排过几次
 */
export function decideRequeue(
  rating: Rating,
  requeuedSoFar: number,
  maxPerCard: number = MAX_REQUEUE_PER_CARD,
): RequeueDecision {
  if (rating !== Rating.Again) return { requeue: false, reason: "recalled" };
  // NaN 走到这里会一路比较失败（NaN >= 6 是 false），所以先归一化，
  // 否则脏数据会变成「永远重排」——比「永不重排」更糟。
  const soFar = Number.isFinite(requeuedSoFar) ? requeuedSoFar : 0;
  const cap = Number.isFinite(maxPerCard) ? maxPerCard : MAX_REQUEUE_PER_CARD;
  if (soFar >= cap) return { requeue: false, reason: "exhausted" };
  return { requeue: true, reason: "ok" };
}

/**
 * 把一个词插回队列，**不追加到末尾**。
 *
 * 追加到末尾看起来最自然，但如果你一轮错 20 个，它们会全部堆在队列最后
 * 连着出现 —— 变成「同一批词互相干扰」的集中练习，是回想训练里最弱的形式。
 * 所以插到「当前进度之后至少 MIN_REQUEUE_GAP 张」的随机位置，
 * 让重排的词自然散开。rng 可注入，测试才能断言。
 */
export function insertRequeue(
  queue: readonly WordRow[],
  index: number,
  word: WordRow,
  rng: () => number = Math.random,
  minGap: number = MIN_REQUEUE_GAP,
): WordRow[] {
  const out = [...queue];
  const earliest = Math.min(index + Math.max(1, minGap), out.length);
  const span = out.length - earliest + 1;
  const jitter = Math.floor(rng() * span);
  const pos = Math.min(earliest + jitter, out.length);
  out.splice(pos, 0, word);
  return out;
}
