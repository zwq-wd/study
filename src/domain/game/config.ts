/**
 * 游戏模式 · 数值常量
 *
 * 全部集中在这里，改数值只改这个文件。
 * 单位：毫秒。设计依据见 docs/游戏模式-设计规格.md §5。
 *
 * v2「打饭机」改版后的核心口径：
 *   答对 5 个词 = 打满一碗饭 = 肥鱼吃一次 = 恢复一格饱食度。
 *   饱食度仍然是 5 格（100 点），但一格的计量单位从「答对一次」变成了「一碗饭」。
 */
import type { Difficulty } from "./types.ts";

/** 一「格」= 多少饱食度；5 格满 */
export const SATIETY_PER_SLOT = 20;

/** 饱食度上限 */
export const SATIETY_MAX = 100;

/** 打满一碗饭要吃进多少个词 */
export const WORDS_PER_BOWL = 5;

/** 一碗饭 = 一格 = 20 点饱食度 */
export const BOWL_SATIETY = SATIETY_PER_SLOT;

/** 现场最多同时摆几碗饭（打满但还没被吃掉的）；超出的直接算作已消化 */
export const MAX_PENDING_BOWLS = 5;

/** 每档的调参 */
export interface DifficultyProfile {
  /** 一格的毫秒数（饱食度 20 点 = 一碗饭的时间） */
  msPerSlot: number;
  /** 归零后的宽限期（毫秒） */
  graceMs: number;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: { msPerSlot: 12_000, graceMs: 12_000 },
  normal: { msPerSlot: 8_000, graceMs: 10_000 },
  hard: { msPerSlot: 5_000, graceMs: 8_000 },
};

/** 每秒掉多少饱食度 */
export function drainPerSecond(difficulty: Difficulty): number {
  const p = DIFFICULTY_PROFILES[difficulty];
  return SATIETY_PER_SLOT / (p.msPerSlot / 1000);
}

/** 饱食度低于这个值开始发抖 */
export const TREMBLE_THRESHOLD = 30;

/** 饱食度低于这个值饱食度条脉冲 */
export const CRITICAL_THRESHOLD = 20;

/** 相邻几题之内不重复出同一个词 */
export const NO_REPEAT_WINDOW = 3;

/** 生成干扰项时最多重抽几次 */
export const DISTRACTOR_RETRY_LIMIT = 12;

/** 每局出题池最多取多少词（防止一次拉太多） */
export const POOL_LIMIT = 200;
