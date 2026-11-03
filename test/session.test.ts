import { describe, expect, it } from "vitest";
import {
  buildSession,
  shuffle,
  sortCandidates,
} from "../src/domain/scheduler/session.ts";
import type { WordRow } from "../src/data/types.ts";

function row(partial: Partial<WordRow> & { id: number }): WordRow {
  return {
    id: partial.id,
    headword: partial.headword ?? `w${partial.id}`,
    norm: partial.norm ?? `w${partial.id}`,
    phonetic: null,
    source: null,
    note: null,
    example_json: null,
    status: partial.status ?? "learning",
    fsrs_state: partial.fsrs_state ?? 2,
    fsrs_due: partial.fsrs_due ?? 0,
    fsrs_due_day: "fsrs_due_day" in partial ? (partial.fsrs_due_day ?? null) : "2026-10-27",
    fsrs_stability: partial.fsrs_stability ?? 10,
    fsrs_difficulty: partial.fsrs_difficulty ?? 5,
    fsrs_reps: partial.fsrs_reps ?? 2,
    fsrs_lapses: partial.fsrs_lapses ?? 0,
    fsrs_scheduled_days: partial.fsrs_scheduled_days ?? 4,
    fsrs_last_review: partial.fsrs_last_review ?? null,
    created_at: 0,
    updated_at: 0,
  };
}

/** 固定随机源：永远返回 0，Fisher–Yates 会退化成一次确定的旋转，便于断言。 */
const zeroRng = (): number => 0;

/** 依次吐出给定序列，用完后返回 0。 */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

const ids = (rows: readonly WordRow[]): number[] => rows.map((r) => r.id);

describe("buildSession", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => row({ id: i + 1 }));

  it("空输入", () => {
    expect(buildSession([], 150)).toEqual({ picked: [], deferred: 0 });
  });

  it("limit = 0", () => {
    const r = buildSession(candidates, 0);
    expect(r.picked).toHaveLength(0);
    expect(r.deferred).toBe(10);
  });

  it("limit 大于候选数：全排进来，顺延 0", () => {
    const r = buildSession(candidates, 150);
    expect(r.picked).toHaveLength(10);
    expect(r.deferred).toBe(0);
  });

  it("limit 小于候选数：顺延 = 差额", () => {
    const r = buildSession(candidates, 4);
    expect(r.picked).toHaveLength(4);
    expect(r.deferred).toBe(6);
  });

  it("includeAll 忽略上限", () => {
    const r = buildSession(candidates, 2, true);
    expect(r.picked).toHaveLength(10);
    expect(r.deferred).toBe(0);
  });

  it("不改动入参数组", () => {
    const input = [...candidates];
    buildSession(input, 3);
    expect(input).toHaveLength(10);
  });

  it("负数与非法 limit 得当 0", () => {
    expect(buildSession(candidates, -5).picked).toHaveLength(0);
    expect(buildSession(candidates, Number.NaN).picked).toHaveLength(0);
  });

  // ---------------------------------------------------------------- 乱序（§5.7）

  it("选词仍按逾期顺序取前 N，洗的只是出场顺序", () => {
    // rng 恒为 0 时，Fisher–Yates 是确定的：结果可预测但仍是同一批词
    const r = buildSession(candidates, 4, false, zeroRng);
    expect(r.deferred).toBe(6);
    // 一定是前 4 条里的词 —— 顺延集合没被随机破坏
    expect([...ids(r.picked)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("乱序：出场顺序不再等于逾期顺序", () => {
    const r = buildSession(candidates, 10, false, zeroRng);
    expect(ids(r.picked)).not.toEqual(ids(candidates));
  });

  it("乱序：不增不减，是同一个多重集", () => {
    const r = buildSession(candidates, 10, false, zeroRng);
    expect([...ids(r.picked)].sort((a, b) => a - b)).toEqual(ids(candidates));
  });

  it("洗牌不重复、不丢词（更大样本）", () => {
    const many = Array.from({ length: 150 }, (_, i) => row({ id: i + 1 }));
    const r = buildSession(many, 150, false, Math.random);
    const got = ids(r.picked);
    expect(got).toHaveLength(150);
    expect(new Set(got).size).toBe(150);
  });
});

describe("shuffle", () => {
  it("空数组 / 单元素不变", () => {
    expect(shuffle([], zeroRng)).toEqual([]);
    expect(shuffle([7], zeroRng)).toEqual([7]);
  });

  it("不改入参", () => {
    const input = [1, 2, 3, 4];
    shuffle(input, zeroRng);
    expect(input).toEqual([1, 2, 3, 4]);
  });

  it("是同一多重集", () => {
    const input = [1, 2, 3, 4, 5];
    expect([...shuffle(input, zeroRng)].sort((a, b) => a - b)).toEqual(input);
  });

  it("rng 决定结果：不同随机源给出不同排列", () => {
    const input = [1, 2, 3, 4, 5];
    const a = shuffle(input, zeroRng);
    const b = shuffle(input, seqRng([0.9, 0.9, 0.9, 0.9, 0.9]));
    expect(a).not.toEqual(b);
  });
});

describe("sortCandidates", () => {
  it("按 due_day 升序（逾期最久优先）", () => {
    const rows = [
      row({ id: 1, fsrs_due_day: "2026-10-27" }),
      row({ id: 2, fsrs_due_day: "2026-10-20" }),
      row({ id: 3, fsrs_due_day: "2026-10-25" }),
    ];
    expect(sortCandidates(rows).map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("同一 due_day 时 stability 小的优先", () => {
    const rows = [
      row({ id: 1, fsrs_due_day: "2026-10-27", fsrs_stability: 50 }),
      row({ id: 2, fsrs_due_day: "2026-10-27", fsrs_stability: 5 }),
    ];
    expect(sortCandidates(rows).map((r) => r.id)).toEqual([2, 1]);
  });

  it("due_day 与 stability 都相同时按 id", () => {
    const rows = [
      row({ id: 5, fsrs_due_day: "2026-10-27", fsrs_stability: 5 }),
      row({ id: 3, fsrs_due_day: "2026-10-27", fsrs_stability: 5 }),
    ];
    expect(sortCandidates(rows).map((r) => r.id)).toEqual([3, 5]);
  });

  it("due_day 为 null 的排最后", () => {
    const rows = [
      row({ id: 1, fsrs_due_day: null }),
      row({ id: 2, fsrs_due_day: "2026-10-27" }),
    ];
    expect(sortCandidates(rows).map((r) => r.id)).toEqual([2, 1]);
  });

  it("排序稳定：不改入参", () => {
    const rows = [row({ id: 1, fsrs_due_day: "2026-10-27" }), row({ id: 2, fsrs_due_day: "2026-10-20" })];
    const sorted = sortCandidates(rows);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    expect(sorted.map((r) => r.id)).toEqual([2, 1]);
  });
});
