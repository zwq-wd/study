import { describe, expect, it } from "vitest";
import { buildImportPlan, type ExistingWordInfo } from "../src/domain/importPlan.ts";

const info = (
  norm: string,
  meanings: string[] = [],
  lastReviewDay: string | null = null,
): ExistingWordInfo => ({ norm, headword: norm, meanings, lastReviewDay });

describe("buildImportPlan", () => {
  it("全新词 → 全部 new", () => {
    const plan = buildImportPlan("abandon 放弃\nabstract 抽象的", { existing: [] });
    expect(plan.summary).toMatchObject({
      totalRows: 2,
      newWords: 2,
      appendSenses: 0,
      duplicates: 0,
      noMeaning: 0,
      errors: 0,
    });
  });

  it("已存在且意思相同 → duplicate，并给出「最后复习于」提示", () => {
    const plan = buildImportPlan("abandon 放弃", {
      existing: [info("abandon", ["放弃"], "2026-10-20")],
    });
    expect(plan.summary.duplicates).toBe(1);
    expect(plan.decisions[0]?.action).toBe("duplicate");
    expect(plan.decisions[0]?.note).toBe("已存在，最后复习于 2026-10-20");
  });

  it("已存在但意思不同 → append（只追加新的那条）", () => {
    const plan = buildImportPlan("abandon 放弃；抛弃", {
      existing: [info("abandon", ["放弃"], "2026-10-20")],
    });
    expect(plan.summary.appendSenses).toBe(1);
    expect(plan.decisions[0]?.action).toBe("append");
    expect(plan.decisions[0]?.meanings).toEqual(["抛弃"]);
  });

  it("已存在但没有复习记录 → 提示不同措辞", () => {
    const plan = buildImportPlan("abandon 放弃", { existing: [info("abandon", ["放弃"])] });
    expect(plan.decisions[0]?.note).toBe("已存在，还没有复习记录");
  });

  it("无释义新词 → 允许落库但计入 noMeaning", () => {
    const plan = buildImportPlan("abandon", { existing: [] });
    expect(plan.summary.newWords).toBe(1);
    expect(plan.summary.noMeaning).toBe(1);
    expect(plan.decisions[0]?.note).toBe("无释义，先建卡");
  });

  it("错误行单独统计，不落库", () => {
    const plan = buildImportPlan("放弃 abandon\nabstract 抽象的", { existing: [] });
    expect(plan.summary.errors).toBe(1);
    expect(plan.summary.newWords).toBe(1);
    expect(plan.parseErrors).toHaveLength(1);
    expect(plan.parseErrors[0]?.lineNo).toBe(1);
  });

  it("批内重复：第二次出现算 duplicate", () => {
    const plan = buildImportPlan("abandon 放弃\nAbandon 抛弃", { existing: [] });
    expect(plan.summary.newWords).toBe(1);
    expect(plan.summary.duplicates).toBe(1);
    expect(plan.decisions[1]?.note).toBe("本批输入里重复出现");
  });

  it("疑似重复只提示、不改变 action", () => {
    const plan = buildImportPlan("abandoned 被抛弃的", { existing: [info("abandon", ["放弃"])] });
    expect(plan.summary.newWords).toBe(1);
    expect(plan.decisions[0]?.action).toBe("new");
    expect(plan.decisions[0]?.similarTo).toBe("abandon");
  });

  it("符合文档 §9.3 的 38 行示例数字结构", () => {
    const raw = [
      "abandon 放弃；抛弃",
      "abstract 抽象的",
      "accommodate\t容纳",
      "abandon 放弃", // 批内重复
    ].join("\n");
    const plan = buildImportPlan(raw, { existing: [info("abstract", ["抽象的"])] });
    expect(plan.summary.totalRows).toBe(4);
    expect(plan.summary.newWords).toBe(2);
    expect(plan.summary.duplicates).toBe(2);
    expect(plan.summary.errors).toBe(0);
  });

  it("summary 与 decisions 永远自洽", () => {
    const raw = "a 甲\nb 乙\nc\nd 丁；戊";
    const plan = buildImportPlan(raw, { existing: [info("a", ["甲"])] });
    expect(plan.summary.totalRows).toBe(plan.decisions.length);
    expect(plan.summary.newWords).toBe(plan.decisions.filter((d) => d.action === "new").length);
    expect(plan.summary.appendSenses).toBe(plan.decisions.filter((d) => d.action === "append").length);
    expect(plan.summary.duplicates).toBe(plan.decisions.filter((d) => d.action === "duplicate").length);
  });

  it("空输入不出错", () => {
    const plan = buildImportPlan("", { existing: [] });
    expect(plan.decisions).toHaveLength(0);
    expect(plan.summary.totalRows).toBe(0);
  });
});
