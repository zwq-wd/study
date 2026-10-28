import { describe, expect, it } from "vitest";
import { parseInput, splitMeanings } from "../src/domain/normalize/parseInput.ts";

describe("splitMeanings", () => {
  it("按 ；;，,/ 拆分", () => {
    expect(splitMeanings("放弃；抛弃")).toEqual(["放弃", "抛弃"]);
    expect(splitMeanings("容纳; 适应")).toEqual(["容纳", "适应"]);
    expect(splitMeanings("抽象的，深奥的")).toEqual(["抽象的", "深奥的"]);
    expect(splitMeanings("放弃/抛弃")).toEqual(["放弃", "抛弃"]);
    expect(splitMeanings("放弃,抛弃")).toEqual(["放弃", "抛弃"]);
  });

  it("去掉空段与重复义项", () => {
    expect(splitMeanings("放弃；；放弃")).toEqual(["放弃"]);
    expect(splitMeanings("  ")).toEqual([]);
  });
});

describe("parseInput", () => {
  it("word + 空格 + 中文", () => {
    const r = parseInput("abandon 放弃；抛弃");
    expect(r.errors).toHaveLength(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      lineNo: 1,
      headword: "abandon",
      norm: "abandon",
      meanings: ["放弃", "抛弃"],
    });
  });

  it("word + Tab + 中文", () => {
    const r = parseInput("abandon\tv. 放弃");
    expect(r.lines[0]?.norm).toBe("abandon");
    expect(r.lines[0]?.meanings).toEqual(["v. 放弃"]);
  });

  it("只有英文", () => {
    const r = parseInput("abandon");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.meanings).toEqual([]);
    expect(r.noMeaning).toEqual([1]);
  });

  it("空行被忽略且计入 blankLines", () => {
    const r = parseInput("abandon 放弃\n\n\nabstract 抽象的");
    expect(r.lines).toHaveLength(2);
    expect(r.blankLines).toBe(2);
    expect(r.errors).toHaveLength(0);
  });

  it("中文在前英文在后应报错", () => {
    const r = parseInput("放弃 abandon");
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]?.lineNo).toBe(1);
    // 仍然会把「放弃」当成英文（它是非 ASCII，跳过前导非字母数字后没有 ASCII 字母）
    expect(r.lines).toHaveLength(0);
  });

  it("前导空白与点号", () => {
    const r = parseInput("   1. abandon 放弃");
    expect(r.lines[0]?.headword).toBe("abandon");
    expect(r.lines[0]?.meanings).toEqual(["放弃"]);
  });

  it("大小写归一", () => {
    const r = parseInput("Abandon 放弃");
    expect(r.lines[0]?.headword).toBe("Abandon");
    expect(r.lines[0]?.norm).toBe("abandon");
  });

  it("含连字符与撇号", () => {
    const r = parseInput("well-known 著名的\ndon't 不");
    expect(r.lines.map((l) => l.norm)).toEqual(["well-known", "don't"]);
  });

  it("多词短语保留内部空格", () => {
    const r = parseInput("used to 过去常常");
    expect(r.lines[0]?.headword).toBe("used to");
    expect(r.lines[0]?.norm).toBe("used to");
    expect(r.lines[0]?.meanings).toEqual(["过去常常"]);
  });

  it("批内重复会被记到 duplicatesInInput", () => {
    const r = parseInput("abandon 放弃\nAbandon 抛弃");
    expect(r.duplicatesInInput).toEqual(["abandon"]);
    expect(r.lines).toHaveLength(2);
  });

  it("保留行号，中间的错误行不会让后面错位", () => {
    const r = parseInput("abandon 放弃\n123 456\nabstract 抽象的");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.lineNo).toBe(2);
    expect(r.lines.map((l) => l.lineNo)).toEqual([1, 3]);
  });

  it("CRLF 换行也能解析", () => {
    const r = parseInput("abandon 放弃\r\nabstract 抽象的");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]?.norm).toBe("abstract");
  });

  it("纯中文行报错", () => {
    const r = parseInput("放弃；抛弃");
    expect(r.errors).toHaveLength(1);
  });
});
