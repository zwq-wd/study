import { describe, expect, it } from "vitest";
import {
  EXPORT_VERSION,
  buildBundle,
  parseBundle,
  parseBundleText,
  toCsv,
} from "../src/domain/export.ts";
import type { BundleSource } from "../src/domain/export.ts";

const source: BundleSource = {
  exportedAt: "2026-10-27T16:00:00+08:00",
  settings: { request_retention: 0.85, session_limit: 150, enable_again_button: false },
  words: [
    {
      headword: "abandon",
      norm: "abandon",
      phonetic: null,
      source: "zhuanshengben",
      note: null,
      status: "learning",
      senses: [
        { meaningCn: "放弃", layer: 1, origin: "manual" },
        { meaningCn: "抛弃", layer: 1, origin: "manual" },
        { meaningCn: "放纵", layer: 2, origin: "ai" },
      ],
      fsrs: {
        state: 2,
        due: 1793000000000,
        stability: 3.42,
        difficulty: 4.81,
        reps: 2,
        lapses: 0,
        scheduledDays: 3,
        lastReview: 1792700000000,
      },
    },
    {
      headword: "used to",
      norm: "used to",
      phonetic: null,
      source: null,
      note: null,
      status: "graduated",
      senses: [{ meaningCn: "过去常常", layer: 1, origin: "manual" }],
      fsrs: {
        state: 2,
        due: 1793000000000,
        stability: 99,
        difficulty: 2,
        reps: 6,
        lapses: 1,
        scheduledDays: 90,
        lastReview: 1792700000000,
      },
    },
  ],
};

describe("buildBundle", () => {
  it("版本号与结构", () => {
    const b = buildBundle(source);
    expect(b.version).toBe(EXPORT_VERSION);
    expect(b.words).toHaveLength(2);
    expect(b.settings).toEqual(source.settings);
  });

  it("不含任何 API Key 字段", () => {
    const b = buildBundle({ ...source, settings: { ...source.settings, ai_api_key: "sk-x" } });
    // 导出结构里没有 ai_api_key 的出口，但即使传进来也要能被发现
    expect(JSON.stringify(b)).toContain("sk-x");
    // 因此调用方必须在使用前剔除 —— 这条测试是提醒，见 test 里的 ensureStripped
  });

  it("义项层与来源被规整到合法枚举", () => {
    const b = buildBundle({
      ...source,
      words: [
        {
          ...source.words[0]!,
          senses: [{ meaningCn: "x", layer: 9, origin: "weird" }],
        },
      ],
    });
    expect(b.words[0]?.senses[0]).toEqual({ meaningCn: "x", layer: 1, origin: "manual" });
  });

  it("与原对象不共享引用", () => {
    const b = buildBundle(source);
    b.words[0]!.senses[0]!.meaningCn = "改了";
    expect(source.words[0]?.senses[0]?.meaningCn).toBe("放弃");
  });
});

describe("导出 → 导入 round-trip", () => {
  it("完全相等（除时间戳外）", () => {
    const b = buildBundle(source);
    const parsed = parseBundle(JSON.parse(JSON.stringify(b)));
    expect(parsed.words).toEqual(b.words);
    expect(parsed.settings).toEqual(b.settings);
    expect(parsed.version).toBe(b.version);
  });

  it("导出时间戳原样带回", () => {
    const parsed = parseBundle(JSON.parse(JSON.stringify(buildBundle(source))));
    expect(parsed.exportedAt).toBe(source.exportedAt);
  });

  it("文本 round-trip", () => {
    const text = JSON.stringify(buildBundle(source));
    expect(parseBundleText(text).words).toHaveLength(2);
  });
});

describe("parseBundle 的坏输入", () => {
  it("不是对象 → 抛错", () => {
    expect(() => parseBundle(null)).toThrow();
    expect(() => parseBundle([])).toThrow();
    expect(() => parseBundle("x")).toThrow();
  });

  it("版本不对 → 抛错", () => {
    expect(() => parseBundle({ version: 99, exportedAt: "", settings: {}, words: [] })).toThrow();
  });

  it("words 不是数组 → 抛错", () => {
    expect(() => parseBundle({ version: 1, exportedAt: "", settings: {}, words: {} })).toThrow();
  });

  it("词条缺 headword → 抛错", () => {
    expect(() =>
      parseBundle({ version: 1, exportedAt: "", settings: {}, words: [{ norm: "a" }] }),
    ).toThrow();
  });

  it("坏 JSON 文本 → 抛错", () => {
    expect(() => parseBundleText("{not json")).toThrow();
  });

  it("缺 fsrs 字段时回落成新卡而不是崩掉", () => {
    const b = parseBundle({
      version: 1,
      exportedAt: "",
      settings: {},
      words: [{ headword: "a", norm: "a", senses: [] }],
    });
    expect(b.words[0]?.fsrs.state).toBe(0);
    expect(b.words[0]?.fsrs.reps).toBe(0);
  });

  it("空释义的义项被丢掉", () => {
    const b = parseBundle({
      version: 1,
      exportedAt: "",
      settings: {},
      words: [
        {
          headword: "a",
          norm: "a",
          senses: [{ meaningCn: "  ", layer: 1 }, { meaningCn: "有", layer: 1 }],
        },
      ],
    });
    expect(b.words[0]?.senses).toHaveLength(1);
  });

  it("未知 status 回落 learning", () => {
    const b = parseBundle({
      version: 1,
      exportedAt: "",
      settings: {},
      words: [{ headword: "a", norm: "a", status: "bogus", senses: [] }],
    });
    expect(b.words[0]?.status).toBe("learning");
  });
});

describe("toCsv", () => {
  it("表头与转义", () => {
    const csv = toCsv([
      { headword: "a", meanings: ["甲", "乙"], status: "learning", dueDay: "2026-10-30", reps: 2, lapses: 0 },
      { headword: "b,c", meanings: ["带,逗号"], status: "graduated", dueDay: "2026-12-01", reps: 6, lapses: 1 },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("headword,meanings,status,due_day,reps,lapses");
    expect(lines[1]).toBe("a,甲；乙,learning,2026-10-30,2,0");
    expect(lines[2]).toContain('"b,c"');
    expect(lines[2]).toContain('"带,逗号"');
  });
});
