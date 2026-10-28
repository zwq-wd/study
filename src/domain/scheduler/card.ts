/**
 * 行 ↔ ts-fsrs Card 转换（开发文档 §5.8）
 *
 * 这是**唯一**允许碰 FSRS 字段的地方。
 *
 * 两个写死的 0：
 * - elapsed_days：库里不存，ts-fsrs 每次 next() 会按 last_review 自己算
 * - learning_steps：enable_short_term=false 时完全不参与计算
 * 所以数据库不为它们建列（少两列，少一类「存了但没人读」的僵尸数据）。
 */
import { createEmptyCard, State, type Card } from "ts-fsrs";
import type { WordRow } from "../../data/types.ts";

/** 数据库行和 Card 的最小交集，避免这里依赖完整 WordRow。 */
export type CardCarrier = Pick<
  WordRow,
  | "fsrs_state"
  | "fsrs_due"
  | "fsrs_stability"
  | "fsrs_difficulty"
  | "fsrs_reps"
  | "fsrs_lapses"
  | "fsrs_scheduled_days"
  | "fsrs_last_review"
>;

function validState(n: number): State {
  return n === 0 || n === 1 || n === 2 || n === 3 ? (n as State) : State.New;
}

export function toCard(w: CardCarrier, fallbackNow: Date): Card {
  // 损坏数据兜底：状态是 Review 但 stability 为 0 → 当作新卡（§5.9）
  const state = validState(w.fsrs_state);
  if (state === State.Review && !(w.fsrs_stability > 0)) {
    return createEmptyCard(fallbackNow);
  }

  const card: Card = {
    due: new Date(w.fsrs_due ?? fallbackNow.getTime()),
    stability: w.fsrs_stability,
    difficulty: w.fsrs_difficulty,
    elapsed_days: 0,
    scheduled_days: w.fsrs_scheduled_days,
    learning_steps: 0,
    reps: w.fsrs_reps,
    lapses: w.fsrs_lapses,
    state,
  };
  if (w.fsrs_last_review !== null) card.last_review = new Date(w.fsrs_last_review);
  return card;
}

/** Card → 可直接写进 words 表的字段（不含 status / updated_at）。 */
export function fromCard(card: Card): Pick<
  WordRow,
  | "fsrs_state"
  | "fsrs_due"
  | "fsrs_stability"
  | "fsrs_difficulty"
  | "fsrs_reps"
  | "fsrs_lapses"
  | "fsrs_scheduled_days"
  | "fsrs_last_review"
> {
  return {
    fsrs_state: card.state,
    fsrs_due: card.due.getTime(),
    fsrs_stability: card.stability,
    fsrs_difficulty: card.difficulty,
    fsrs_reps: card.reps,
    fsrs_lapses: card.lapses,
    fsrs_scheduled_days: card.scheduled_days,
    fsrs_last_review: card.last_review ? card.last_review.getTime() : null,
  };
}
