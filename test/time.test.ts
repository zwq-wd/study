import { describe, expect, it } from "vitest";
import { addDays, dayKey, daysBetween, describeDay } from "../src/domain/time.ts";

/** 用本地时间构造，避免时区把测试搞歪。 */
const local = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

describe("dayKey", () => {
  it("03:59 归前一天", () => {
    expect(dayKey(local(2026, 10, 27, 3, 59))).toBe("2026-10-26");
  });

  it("04:00 归当天", () => {
    expect(dayKey(local(2026, 10, 27, 4, 0))).toBe("2026-10-27");
  });

  it("白天归当天", () => {
    expect(dayKey(local(2026, 10, 27, 15, 30))).toBe("2026-10-27");
  });

  it("跨月", () => {
    expect(dayKey(local(2026, 11, 1, 2, 0))).toBe("2026-10-31");
  });

  it("跨年", () => {
    expect(dayKey(local(2027, 1, 1, 1, 0))).toBe("2026-12-31");
  });

  it("边界小时可配置", () => {
    expect(dayKey(local(2026, 10, 27, 4, 30), 5)).toBe("2026-10-26");
    expect(dayKey(local(2026, 10, 27, 5, 0), 5)).toBe("2026-10-27");
  });

  it("边界 0 时就是自然日", () => {
    expect(dayKey(local(2026, 10, 27, 0, 0), 0)).toBe("2026-10-27");
  });
});

describe("daysBetween", () => {
  it("同一天 0", () => {
    expect(daysBetween("2026-10-27", "2026-10-27")).toBe(0);
  });

  it("往后为正", () => {
    expect(daysBetween("2026-10-27", "2026-10-30")).toBe(3);
  });

  it("往前为负", () => {
    expect(daysBetween("2026-10-27", "2026-10-24")).toBe(-3);
  });
});

describe("addDays", () => {
  it("跨月", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });

  it("跨年", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("加 0", () => {
    expect(addDays("2026-10-27", 0)).toBe("2026-10-27");
  });
});

describe("describeDay", () => {
  it("今天 / 明天 / N 天后 / 逾期 N 天", () => {
    expect(describeDay("2026-10-27", "2026-10-27")).toBe("今天");
    expect(describeDay("2026-10-28", "2026-10-27")).toBe("明天");
    expect(describeDay("2026-10-30", "2026-10-27")).toBe("3 天后");
    expect(describeDay("2026-10-25", "2026-10-27")).toBe("逾期 2 天");
  });
});
