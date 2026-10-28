import { describe, expect, it } from "vitest";
import { computeStats } from "../src/domain/stats.ts";
import type { WordRow } from "../src/data/types.ts";

function row(id: number, dueDay: string | null): WordRow {
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
    fsrs_due_day: dueDay,
    fsrs_stability: 5,
    fsrs_difficulty: 5,
    fsrs_reps: 1,
    fsrs_lapses: 0,
    fsrs_scheduled_days: 4,
    fsrs_last_review: null,
    created_at: 0,
    updated_at: 0,
  };
}

const base = {
  total: 10,
  learning: 9,
  graduated: 1,
  today: "2026-10-27",
  deferred: 0,
  nextDueDay: null as string | null,
};

describe("computeStats", () => {
  it("空队列：四个数字都对", () => {
    const s = computeStats({ ...base, dueRows: [], total: 0, learning: 0, graduated: 0 });
    expect(s.dueToday).toBe(0);
    expect(s.maxOverdueDays).toBe(0);
    expect(s.nextDueInDays).toBeNull();
  });

  it("逾期最久：due 早于今天的天数（符号不能反）", () => {
    const dueRows = [
      row(1, "2026-10-20"), // 逾期 7
      row(2, "2026-10-25"), // 逾期 2
      row(3, "2026-10-27"), // 今天，逾期 0
    ];
    const s = computeStats({ ...base, dueRows });
    expect(s.dueToday).toBe(3);
    expect(s.maxOverdueDays).toBe(7);
  });

  it("逾期最久跨月", () => {
    const s = computeStats({ ...base, dueRows: [row(1, "2026-09-01")] });
    expect(s.maxOverdueDays).toBe(56);
  });

  it("下次到期最早 = 今天之后的最早日", () => {
    expect(computeStats({ ...base, dueRows: [], nextDueDay: "2026-10-31" }).nextDueInDays).toBe(4);
  });

  it("下次到期就是今天 → 0", () => {
    expect(computeStats({ ...base, dueRows: [], nextDueDay: "2026-10-27" }).nextDueInDays).toBe(0);
  });

  it("没有未来到期 → null", () => {
    expect(computeStats({ ...base, dueRows: [], nextDueDay: null }).nextDueInDays).toBeNull();
  });

  it("due_day 为 null 的行被跳过，不参与逾期计算", () => {
    const s = computeStats({ ...base, dueRows: [row(1, null), row(2, "2026-10-25")] });
    expect(s.maxOverdueDays).toBe(2);
  });
});
