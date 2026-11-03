import { describe, expect, it } from "vitest";
import { buildRereview } from "../src/domain/scheduler/rereview.ts";
import { dayRange } from "../src/domain/time.ts";
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
const zeroRng = (): number => 0;

describe("buildRereview", () => {
  const candidates = Array.from({ length: 24 }, (_, i) => row(i + 1));

  it("空输入 → 什么都不看", () => {
    expect(buildRereview([], 150)).toEqual({ picked: [], deferred: 0 });
  });

  it("候选少于上限：全排进来，顺延 0", () => {
    const r = buildRereview(candidates, 150);
    expect(r.picked).toHaveLength(24);
    expect(r.deferred).toBe(0);
  });

  it("候选多于上限：只取前 limit，其余算顺延", () => {
    const r = buildRereview(candidates, 10);
    expect(r.picked).toHaveLength(10);
    expect(r.deferred).toBe(14);
  });

  it("不改动入参数组", () => {
    const input = [...candidates];
    buildRereview(input, 5);
    expect(input).toHaveLength(24);
  });

  // 早退 / 提前关软件时上限为 0 不该导致「一张都不看」：
  // 重看是零成本操作，看漏几张不如全看。这是刻意与 buildSession 不同的取舍。
  it("limit = 0 / 负数 / NaN 时当作没有上限，而不是一张都不看", () => {
    expect(buildRereview(candidates, 0).picked).toHaveLength(24);
    expect(buildRereview(candidates, -5).picked).toHaveLength(24);
    expect(buildRereview(candidates, Number.NaN).picked).toHaveLength(24);
  });

  it("出场顺序被打乱（否则会靠位置记住下一张）", () => {
    const r = buildRereview(candidates, 24, zeroRng);
    expect(ids(r.picked)).not.toEqual(ids(candidates));
  });

  it("洗牌不增不减，是同一个多重集", () => {
    const r = buildRereview(candidates, 24);
    expect([...ids(r.picked)].sort((a, b) => a - b)).toEqual(ids(candidates));
    expect(new Set(ids(r.picked)).size).toBe(24);
  });
});

/**
 * 重新复习靠「今天这一场日志里的 Again」筛出候选词，
 * 而日志时间戳是 epoch 毫秒、日键带边界小时。dayRange 是这两者的桥梁，
 * 边界算错一天，就会把昨天背错的词也算成今天的。
 */
describe("dayRange（日键 → 时间区间，边界小时）", () => {
  const H = 3_600_000;

  it("默认边界 04:00：今天从 04:00 到明天 04:00", () => {
    const { start, end } = dayRange("2026-11-03", 4);
    const s = new Date(start);
    const e = new Date(end);
    expect(s.getHours()).toBe(4);
    expect(s.getDate()).toBe(3);
    expect(e.getHours()).toBe(4);
    expect(e.getDate()).toBe(4);
  });

  it("区间长度正好 24 小时", () => {
    const { start, end } = dayRange("2026-11-03", 4);
    expect(end - start).toBe(24 * H);
  });

  it("跨月边界不越界", () => {
    const { start, end } = dayRange("2026-12-31", 4);
    expect(new Date(start).getMonth()).toBe(11);
    expect(new Date(end).getMonth()).toBe(0);
    expect(new Date(end).getFullYear()).toBe(2027);
  });

  it("边界为 0 时就是当天 00:00 到次日 00:00", () => {
    const { start } = dayRange("2026-11-03", 0);
    expect(new Date(start).getHours()).toBe(0);
  });

  it("与 dayKey 互为逆运算：凌晨 2 点属于「昨天」", () => {
    const boundary = 4;
    // 11-03 凌晨 2 点，按 04:00 边界属于 11-02
    const at = new Date(2026, 10, 3, 2, 0, 0, 0);
    const { start, end } = dayRange("2026-11-02", boundary);
    expect(at.getTime()).toBeGreaterThanOrEqual(start);
    expect(at.getTime()).toBeLessThan(end);
  });

  it("边界前后一刻分属两天", () => {
    const boundary = 4;
    const before = new Date(2026, 10, 3, 3, 59, 0, 0).getTime();
    const after = new Date(2026, 10, 3, 4, 0, 0, 0).getTime();
    const nov2 = dayRange("2026-11-02", boundary);
    const nov3 = dayRange("2026-11-03", boundary);
    expect(before).toBeLessThan(nov2.end);
    expect(before).toBeGreaterThanOrEqual(nov2.start);
    expect(after).toBeGreaterThanOrEqual(nov3.start);
    expect(after).toBeLessThan(nov3.end);
  });
});
