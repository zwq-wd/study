import { describe, expect, it } from "vitest";
import { editDistance, findSimilar, looksSimilar, stemOf } from "../src/domain/normalize/similar.ts";

describe("stemOf", () => {
  it("去 -ing 并处理辅音重复", () => {
    expect(stemOf("running")).toBe("run");
    expect(stemOf("abandoning")).toBe("abandon");
  });

  it("去 -ed", () => {
    expect(stemOf("abandoned")).toBe("abandon");
    expect(stemOf("stopped")).toBe("stop");
  });

  it("去 -s / -es / -ies", () => {
    expect(stemOf("studies")).toBe("study");
    expect(stemOf("cats")).toBe("cat");
  });

  it("去 -ly", () => {
    expect(stemOf("quickly")).toBe("quick");
  });

  it("不误伤短词", () => {
    expect(stemOf("is")).toBe("is");
    expect(stemOf("as")).toBe("as");
  });
});

describe("editDistance", () => {
  it("相等为 0", () => {
    expect(editDistance("abandon", "abandon")).toBe(0);
  });

  it("插入/删除/替换各 1", () => {
    expect(editDistance("abandon", "abandons")).toBe(1);
    expect(editDistance("abandon", "abando")).toBe(1);
    expect(editDistance("abandon", "abandan")).toBe(1);
  });

  it("超过 limit 早停返回 limit+1", () => {
    expect(editDistance("cat", "elephant", 1)).toBeGreaterThan(1);
  });
});

describe("looksSimilar", () => {
  it("abandon / abandoned / abandoning 触发提示", () => {
    expect(looksSimilar("abandoned", "abandon")).toBe(true);
    expect(looksSimilar("abandoning", "abandon")).toBe(true);
  });

  it("run / running 触发", () => {
    expect(looksSimilar("running", "run")).toBe(true);
  });

  it("cat / cut 不触发（词根不同）", () => {
    expect(looksSimilar("cut", "cat")).toBe(false);
  });

  it("完全相同的词不触发（那是 duplicate，不是 similar）", () => {
    expect(looksSimilar("abandon", "abandon")).toBe(false);
  });

  it("毫不相干的词不触发", () => {
    expect(looksSimilar("apple", "zebra")).toBe(false);
  });
});

describe("findSimilar", () => {
  it("在候选池里找到第一个命中的", () => {
    expect(findSimilar("abandoned", ["apple", "abandon", "zebra"])).toBe("abandon");
  });

  it("找不到返回 null", () => {
    expect(findSimilar("elephant", ["apple", "zebra"])).toBeNull();
  });
});
