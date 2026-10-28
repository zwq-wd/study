/**
 * 义项可见性（开发文档 §4.3.3）
 *
 * | 层 | 首次回忆屏（点一下之前） | 点一下之后 |
 * | L1 | 不显示（这是要你回忆的东西） | 显示 |
 * | L2 | 不显示 | 显示，但带「补充」角标，且排在同词第 3 次复习之后才出现 |
 *
 * L2 的出现时机由 fsrs_reps >= 3 控制。理由：如果 L2 一上来就跟着显示，
 * 你下次回忆时会把它当成「我本来就会的」。
 */
import type { SenseRow } from "../data/types.ts";

export const L2_REVEAL_REPS = 3;

export interface RevealOptions {
  /** 是否已经点开答案 */
  revealed: boolean;
  /** 该词已复习次数 */
  reps: number;
}

/** 返回「现在应该显示的义项」。点开之前永远是空数组。 */
export function visibleSenses(senses: readonly SenseRow[], opts: RevealOptions): SenseRow[] {
  if (!opts.revealed) return [];
  const showL2 = opts.reps >= L2_REVEAL_REPS;

  return senses
    .filter((s) => s.layer === 1 || showL2)
    .slice()
    .sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer; // L1 在前
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.id - b.id;
    });
}

/** 这条义项要不要打「补充」角标。 */
export function isSupplement(sense: SenseRow): boolean {
  return sense.layer === 2;
}

/** 首次回忆屏上能不能看到中文 —— 永远看不到。 */
export function canSeeAnswerBeforeReveal(): false {
  return false;
}
