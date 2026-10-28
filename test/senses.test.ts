import { describe, expect, it } from "vitest";
import type { SenseRow } from "../src/data/types.ts";
import { L2_REVEAL_REPS, isSupplement, visibleSenses } from "../src/domain/senses.ts";

const sense = (id: number, layer: number, meaning: string, sort = 0): SenseRow => ({
  id,
  word_id: 1,
  meaning_cn: meaning,
  layer,
  origin: "manual",
  sort,
  created_at: 0,
});

describe("visibleSenses（§4.3.3 义项显示规则）", () => {
  const senses = [sense(1, 1, "放弃"), sense(2, 2, "补充义"), sense(3, 1, "抛弃", 1)];

  it("点开之前：永远看不到中文", () => {
    expect(visibleSenses(senses, { revealed: false, reps: 10 })).toEqual([]);
  });

  it("点开之后、reps < 3：只有 L1", () => {
    const v = visibleSenses(senses, { revealed: true, reps: 2 });
    expect(v.map((s) => s.meaning_cn)).toEqual(["放弃", "抛弃"]);
  });

  it("点开之后、reps >= 3：L1 + L2，且 L1 在前", () => {
    const v = visibleSenses(senses, { revealed: true, reps: 3 });
    expect(v.map((s) => s.meaning_cn)).toEqual(["放弃", "抛弃", "补充义"]);
  });

  it("边界正好是 L2_REVEAL_REPS", () => {
    expect(L2_REVEAL_REPS).toBe(3);
    expect(visibleSenses(senses, { revealed: true, reps: 3 })).toHaveLength(3);
    expect(visibleSenses(senses, { revealed: true, reps: 2 })).toHaveLength(2);
  });

  it("L1 之间按 sort 排", () => {
    const v = visibleSenses([sense(9, 1, "后", 2), sense(8, 1, "前", 1)], {
      revealed: true,
      reps: 1,
    });
    expect(v.map((s) => s.meaning_cn)).toEqual(["前", "后"]);
  });

  it("不改动入参数组", () => {
    const input = [...senses];
    visibleSenses(input, { revealed: true, reps: 5 });
    expect(input.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("isSupplement", () => {
  it("L2 才打「补充」角标", () => {
    expect(isSupplement(sense(1, 2, "x"))).toBe(true);
    expect(isSupplement(sense(1, 1, "x"))).toBe(false);
  });
});
