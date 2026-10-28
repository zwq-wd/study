/**
 * 新建词条（开发文档 §5.5）
 *
 * 你录入的词 = **今天已经背过了**。所以：
 *   const card = createEmptyCard(now)                       // State.New
 *   const { card: next } = f.next(card, now, Rating.Good)   // → State.Review，due = now + I₁
 *
 * 落库后不要让新词当天再排进复习队列，否则你会刚录完就又被要求看一遍。
 */
import { createEmptyCard, Rating, type Card } from "ts-fsrs";
import type { SchedulerConfig } from "./config.ts";
import { buildFsrs } from "./config.ts";

export function newWordCard(now: Date, cfg: SchedulerConfig): Card {
  const f = buildFsrs(cfg);
  const fresh = createEmptyCard(now);
  const { card } = f.next(fresh, now, Rating.Good);
  return card;
}
