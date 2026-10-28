/**
 * 单卡结算（开发文档 §5.8）
 *
 * settle 是纯函数：给它一张卡、一个评分、一个时刻、一份配置，
 * 它给出新卡和新日志。不碰数据库、不碰 Date.now()。
 */
import { Rating, State, type Card, type Grade } from "ts-fsrs";
import type { SchedulerConfig } from "./config.ts";
import { buildFsrs } from "./config.ts";

export interface SettleOutcome {
  card: Card;
  log: {
    rating: Rating;
    state: number;
    due: number;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
  };
  graduated: boolean;
  /** 系统时间回拨：now < last_review 时置 true，调用方应记一条 clock_back 但不推进 */
  clockBack: boolean;
}

/**
 * 毕业判定（§5.6）—— 两个条件必须同时满足，不能只看 scheduled_days。
 * 否则一个刚背第 2 次的新词一次 Good 就能算出 31 天，被夹到上限后立刻「毕业」，
 * 从此再不出现。这是最典型的「毕业判定写错」事故。
 */
export function isGraduated(card: Card, cfg: SchedulerConfig): boolean {
  const natural =
    card.state === State.Review &&
    card.scheduled_days >= cfg.graduateInterval &&
    card.reps >= cfg.minRepsToGraduate;
  return natural || card.lapses >= cfg.graduationOnLapses;
}

export function settle(
  prev: Card,
  rating: Rating,
  now: Date,
  cfg: SchedulerConfig,
): SettleOutcome {
  const f = buildFsrs(cfg);

  // §5.9 系统时间回拨：now < last_review 时 elapsed_days 夹到 0，记一条 clock_back，**不推进**。
  // ts-fsrs 遇到负的 delta_t 会直接抛错（Invalid delta_t），所以这里必须先拦下来，
  // 不能把回拨的时间喂给库。
  const clockBack = prev.last_review != null && now.getTime() < prev.last_review.getTime();
  if (clockBack) {
    return {
      card: prev,
      log: {
        rating,
        state: prev.state,
        due: prev.due.getTime(),
        stability: prev.stability,
        difficulty: prev.difficulty,
        elapsed_days: 0,
        scheduled_days: prev.scheduled_days,
      },
      graduated: false,
      clockBack: true,
    };
  }

  const { card, log } = f.next(prev, now, rating as unknown as Grade);

  // ts-fsrs 的 reviewState 里有 `good_interval = max(good_interval, hard_interval + 1)`，
  // 这会让间隔比 maximum_interval 多出 1 天（实测 50 → 51）。上限是本项目的硬约束，
  // 所以在应用层再夹一次，保证「最大间隔」这个设置真的成立。
  const clamped: Card = { ...card };
  if (clamped.scheduled_days > cfg.maximumInterval) {
    clamped.scheduled_days = cfg.maximumInterval;
    clamped.due = new Date(now.getTime() + cfg.maximumInterval * 86_400_000);
  }

  return {
    card: clamped,
    log: {
      rating,
      state: log.state,
      due: log.due.getTime(),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsed_days: log.elapsed_days,
      scheduled_days: log.scheduled_days,
    },
    graduated: isGraduated(clamped, cfg),
    clockBack: false,
  };
}

/** 当前记忆保持率 0–1，用于「这个词你大概还记得 72%」。 */
export function retrievability(card: Card, now: Date, cfg: SchedulerConfig): number {
  const f = buildFsrs(cfg);
  return f.get_retrievability(card, now, false);
}
