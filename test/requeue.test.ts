import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import {
  MAX_REQUEUE_PER_CARD,
  MIN_REQUEUE_GAP,
  decideRequeue,
  insertRequeue,
} from "../src/domain/scheduler/requeue.ts";
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
    fsrs_due_day: "2026-11-03",
    fsrs_stability: 10,
    fsrs_difficulty: 5,
    fsrs_reps: 2,
    fsrs_lapses: 0,
    fsrs_scheduled_days: 4,
    fsrs_last_review: null,
    created_at: 0,
    updated_at: 0,
  };
}

const ids = (rows: readonly WordRow[]): number[] => rows.map((r) => r.id);
const zeroRng = (): number => 0;

describe("decideRequeue", () => {
  it("背对了就退出重排（这是「直到背对为止」的终止条件）", () => {
    expect(decideRequeue(Rating.Good, 0)).toEqual({ requeue: false, reason: "recalled" });
    // 已经重排过几次也一样：背对就结束
    expect(decideRequeue(Rating.Good, 2)).toEqual({ requeue: false, reason: "recalled" });
  });

  it("背错了就排回队列", () => {
    expect(decideRequeue(Rating.Again, 0)).toEqual({ requeue: true, reason: "ok" });
    expect(decideRequeue(Rating.Again, 1)).toEqual({ requeue: true, reason: "ok" });
  });

  it("重排次数用尽后不再排（防止一个词拖死整场会话）", () => {
    expect(decideRequeue(Rating.Again, MAX_REQUEUE_PER_CARD)).toEqual({
      requeue: false,
      reason: "exhausted",
    });
    expect(decideRequeue(Rating.Again, MAX_REQUEUE_PER_CARD + 3).reason).toBe("exhausted");
  });

  it("上限可注入（测试与将来改配置都用得上）", () => {
    expect(decideRequeue(Rating.Again, 1, 1).reason).toBe("exhausted");
    expect(decideRequeue(Rating.Again, 1, 2).reason).toBe("ok");
  });

  it("上限为 0 时一次都不重排", () => {
    expect(decideRequeue(Rating.Again, 0, 0).reason).toBe("exhausted");
  });

  it("非法的已重排次数按 0 处理（不因为脏数据就永远不重排）", () => {
    expect(decideRequeue(Rating.Again, Number.NaN).requeue).toBe(true);
  });
});

describe("insertRequeue", () => {
  const queue = Array.from({ length: 10 }, (_, i) => row(i + 1));

  it("不改动入参数组", () => {
    const input = [...queue];
    insertRequeue(input, 0, row(99));
    expect(input).toHaveLength(10);
    expect(ids(input)).toEqual(ids(queue));
  });

  it("插回的是一份新的、更长的队列", () => {
    const out = insertRequeue(queue, 0, row(99));
    expect(out).toHaveLength(11);
    expect(ids(out).filter((id) => id === 99)).toHaveLength(1);
  });

  it("至少隔 MIN_REQUEUE_GAP 张才出现（不能紧接着重来）", () => {
    // rng 恒为 0 → 取最早可能的位置
    const out = insertRequeue(queue, 0, row(99), zeroRng);
    const pos = ids(out).indexOf(99);
    expect(pos).toBeGreaterThanOrEqual(MIN_REQUEUE_GAP);
  });

  it("当前位置越靠后，插入点也越靠后", () => {
    const early = ids(insertRequeue(queue, 0, row(99), zeroRng)).indexOf(99);
    const late = ids(insertRequeue(queue, 5, row(99), zeroRng)).indexOf(99);
    expect(late).toBeGreaterThan(early);
  });

  it("接近队尾时不会越界（插到末尾，不插到队列外）", () => {
    const out = insertRequeue(queue, 9, row(99), zeroRng);
    expect(out).toHaveLength(11);
    expect(ids(out)).toContain(99);
    // 必须是连续数组，没有空洞
    expect(ids(out).every((id) => typeof id === "number")).toBe(true);
  });

  it("空队列里也能插（安全边界）", () => {
    const out = insertRequeue([], 0, row(99), zeroRng);
    expect(ids(out)).toEqual([99]);
  });

  it("随机源有效：不同 rng 给出不同插入点", () => {
    const earliest = ids(insertRequeue(queue, 0, row(99), zeroRng)).indexOf(99);
    const latest = ids(insertRequeue(queue, 0, row(99), () => 0.999)).indexOf(99);
    expect(latest).toBeGreaterThan(earliest);
  });

  it("永远插在当前进度之后（不会被放到「已经看过」的区域）", () => {
    for (let idx = 0; idx < 10; idx++) {
      const out = insertRequeue(queue, idx, row(99), () => 0.999);
      expect(ids(out).indexOf(99)).toBeGreaterThan(idx);
    }
  });
});

/**
 * 「直到背到为止」的完整语义 —— 这些是 requeue.ts 存在的理由，
 * 把它写成一条可执行的轨迹，而不是散落在 UI 里的 if。
 */
describe("本轮重排的完整轨迹", () => {
  it("一直背错：看满 MAX_REQUEUE_PER_CARD+1 次后停手", () => {
    let count = 0;
    let appearances = 1; // 第一次出现
    for (let i = 0; i < 10; i++) {
      const d = decideRequeue(Rating.Again, count);
      if (!d.requeue) break;
      count += 1;
      appearances += 1;
    }
    expect(appearances).toBe(MAX_REQUEUE_PER_CARD + 1);
  });

  it("背错 → 背对：背对那一次之后不再回来", () => {
    // 第一次背错，重排；第二次背对，退出
    expect(decideRequeue(Rating.Again, 0).requeue).toBe(true);
    expect(decideRequeue(Rating.Good, 1).requeue).toBe(false);
  });
});
