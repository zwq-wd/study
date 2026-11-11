import { describe, expect, it } from "vitest";
import { buildTodayWords } from "../src/domain/scheduler/todayWords.ts";
import type { WordRow } from "../src/data/types.ts";

function row(id: number): WordRow {
  return {
    id,
    headword: `w${id}`,
    norm: `w${id}`,
    phonetic: null,
    source: null,
    note: null,
    example_json: null,
    status: "learning",
    fsrs_state: 2,
    fsrs_due: 0,
    fsrs_due_day: "2026-11-04",
    fsrs_stability: 0.66,
    fsrs_difficulty: 5,
    fsrs_reps: 2,
    fsrs_lapses: 1,
    fsrs_scheduled_days: 1,
    fsrs_last_review: null,
    created_at: 0,
    updated_at: 0,
  };
}

const ids = (rows: readonly WordRow[]): number[] => rows.map((r) => r.id);
const sortedIds = (rows: readonly WordRow[]): number[] => [...ids(rows)].sort((a, b) => a - b);
const zeroRng = (): number => 0;

describe("buildTodayWords", () => {
  // 调用方（data 层）按 created_at 升序查出来，所以这里的下标顺序就是今天的录入先后。
  const candidates = Array.from({ length: 24 }, (_, i) => row(i + 1));

  it("空输入 → 什么都不看", () => {
    expect(buildTodayWords([], 150)).toEqual({ picked: [], deferred: 0 });
  });

  it("候选少于上限：全排进来，顺延 0", () => {
    const r = buildTodayWords(candidates, 150);
    expect(r.picked).toHaveLength(24);
    expect(r.deferred).toBe(0);
  });

  it("候选多于上限：只取录入最早的 limit 条，其余算顺延", () => {
    const r = buildTodayWords(candidates, 10, zeroRng);
    expect(r.picked).toHaveLength(10);
    expect(r.deferred).toBe(14);
    // 洗的是出场顺序，选哪些词不受随机影响：仍然是今天最先录的那 10 个。
    expect(sortedIds(r.picked)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("不改动入参数组", () => {
    const input = [...candidates];
    buildTodayWords(input, 5);
    expect(input).toHaveLength(24);
    expect(ids(input)).toEqual(ids(candidates));
  });

  // 回看是零成本操作：上限缺失/写坏时看漏几张，比「一张都不看」糟得多。
  // 这是刻意与 buildSession（limit = 0 即不看）不同的取舍，与 buildRereview 一致。
  it("limit = 0 / 负数 / NaN 时当作没有上限，而不是一张都不看", () => {
    expect(buildTodayWords(candidates, 0).picked).toHaveLength(24);
    expect(buildTodayWords(candidates, -5).picked).toHaveLength(24);
    expect(buildTodayWords(candidates, Number.NaN).picked).toHaveLength(24);
  });

  it("出场顺序被打乱（否则会靠位置记住下一张）", () => {
    const r = buildTodayWords(candidates, 24, zeroRng);
    expect(ids(r.picked)).not.toEqual(ids(candidates));
  });

  it("洗牌不增不减，是同一个多重集", () => {
    const r = buildTodayWords(candidates, 24);
    expect(sortedIds(r.picked)).toEqual(ids(candidates));
    expect(new Set(ids(r.picked)).size).toBe(24);
  });
});
