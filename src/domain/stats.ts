/**
 * 首页统计的纯计算部分。
 * 数据从 repo 来，这里只负责把行数组变成四个数字。
 */
import type { HomeStats, WordRow } from "../data/types.ts";
import { daysBetween } from "./time.ts";

export interface StatsInput {
  total: number;
  learning: number;
  graduated: number;
  dueRows: readonly WordRow[];
  today: string;
  deferred: number;
  /** 未来会到期的最早日（含今天之后的），没有就 null */
  nextDueDay: string | null;
}

export function computeStats(input: StatsInput): HomeStats {
  let maxOverdue = 0;
  for (const r of input.dueRows) {
    if (!r.fsrs_due_day) continue;
    // daysBetween(due, today) 在 due 早于 today 时为正 —— 那就是逾期天数
    const overdue = daysBetween(r.fsrs_due_day, input.today);
    if (overdue > maxOverdue) maxOverdue = overdue;
  }

  const nextDueInDays =
    input.nextDueDay === null ? null : Math.max(0, daysBetween(input.today, input.nextDueDay));

  return {
    total: input.total,
    learning: input.learning,
    graduated: input.graduated,
    dueToday: input.dueRows.length,
    deferred: input.deferred,
    nextDueInDays,
    maxOverdueDays: maxOverdue,
  };
}
