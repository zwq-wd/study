import { describe, expect, it } from "vitest";
import { normalizeDisplay, normalizeHeadword } from "../src/domain/normalize/headword.ts";

describe("normalizeHeadword", () => {
  it("大小写折叠", () => {
    expect(normalizeHeadword("Abandon")).toBe("abandon");
    expect(normalizeHeadword("ABANDON")).toBe("abandon");
  });

  it("去首尾空白与折叠内部空白", () => {
    expect(normalizeHeadword("  used   to  ")).toBe("used to");
  });

  it("去首尾非字母数字字符", () => {
    expect(normalizeHeadword("(abandon)")).toBe("abandon");
    expect(normalizeHeadword("-abandon-")).toBe("abandon");
    expect(normalizeHeadword("“hello”")).toBe("hello");
  });

  it("保留内部连字符与撇号", () => {
    expect(normalizeHeadword("well-known")).toBe("well-known");
    expect(normalizeHeadword("don't")).toBe("don't");
  });

  it("空串", () => {
    expect(normalizeHeadword("")).toBe("");
    expect(normalizeHeadword("   ")).toBe("");
  });
});

describe("normalizeDisplay", () => {
  it("保留输入的大小写", () => {
    expect(normalizeDisplay("Abandon")).toBe("Abandon");
    expect(normalizeDisplay("  The   Apple ")).toBe("The Apple");
  });

  it("去首尾杂字符但保留内部", () => {
    expect(normalizeDisplay("[come]")).toBe("come");
  });
});
