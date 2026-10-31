/**
 * AI 校对的纯函数单测（开发文档 §11.1）
 *
 * 重点覆盖「模型是不可信输入源」这条：它会给错类型、编造行号、套 markdown 围栏。
 * 这些都不能让 UI 崩，也不能让用户看到一个不存在的行号。
 */
import { describe, expect, it } from "vitest";
import {
  extractContent,
  extractJsonObject,
  parseFindings,
} from "../src/domain/ai/parse.ts";
import {
  DEFAULT_AI_CONFIG,
  aiConfigFromSettings,
  canRunCheck,
  completionsUrl,
  normalizeAiConfig,
  normalizeBaseUrl,
} from "../src/domain/ai/config.ts";
import {
  CHUNK_SIZE,
  SYSTEM_PROMPT,
  buildUserMessage,
  chunkLines,
} from "../src/domain/ai/prompt.ts";
import { indexFindings, selectLinesForCheck, toneOf } from "../src/domain/ai/apply.ts";
import { hasPartialError } from "../src/domain/ai/types.ts";

describe("extractJsonObject", () => {
  it("解析纯 JSON", () => {
    expect(extractJsonObject('{"issues":[]}')).toEqual({ issues: [] });
  });

  it("剥掉 ```json 围栏", () => {
    const text = '```json\n{"issues":[{"line":1}]}\n```';
    expect(extractJsonObject(text)).toEqual({ issues: [{ line: 1 }] });
  });

  it("剥掉不带语言的围栏", () => {
    expect(extractJsonObject('```\n{"issues":[]}\n```')).toEqual({ issues: [] });
  });

  it("前后有多余解释文字时截取最外层花括号", () => {
    const text = '好的，结果如下：\n{"issues":[]}\n以上。';
    expect(extractJsonObject(text)).toEqual({ issues: [] });
  });

  it("不是 JSON 时返回 null，不抛异常", () => {
    expect(extractJsonObject("我拒绝回答")).toBeNull();
    expect(extractJsonObject("{坏掉的")).toBeNull();
    expect(extractJsonObject("")).toBeNull();
  });

  it("非字符串输入返回 null", () => {
    expect(extractJsonObject(null as unknown as string)).toBeNull();
  });
});

describe("extractContent", () => {
  it("取 OpenAI 兼容响应的正文", () => {
    const payload = { choices: [{ message: { content: "hello" } }] };
    expect(extractContent(payload)).toBe("hello");
  });

  it("结构不对时返回 null", () => {
    expect(extractContent(null)).toBeNull();
    expect(extractContent({})).toBeNull();
    expect(extractContent({ choices: [] })).toBeNull();
    expect(extractContent({ choices: [{ message: {} }] })).toBeNull();
    expect(extractContent({ choices: [{ message: { content: 42 } }] })).toBeNull();
  });
});

describe("parseFindings", () => {
  const known = new Map<number, string>([
    [1, "acommodate"],
    [2, "abandon"],
    [3, "recieve"],
  ]);

  it("正常结果原样收敛", () => {
    const out = parseFindings(
      {
        issues: [
          { line: 1, kind: "spelling", suggestion: "accommodate", reason: "少一个 m" },
        ],
      },
      known,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      lineNo: 1,
      headword: "acommodate",
      kind: "spelling",
      suggestion: "accommodate",
      reason: "少一个 m",
    });
  });

  it("丢弃本次没送检的行号（防模型幻觉）", () => {
    const out = parseFindings(
      { issues: [{ line: 999, kind: "spelling", reason: "x" }] },
      known,
    );
    expect(out).toHaveLength(0);
  });

  it("丢弃未知的 kind", () => {
    const out = parseFindings(
      { issues: [{ line: 2, kind: "语法不对", reason: "x" }] },
      known,
    );
    expect(out).toHaveLength(0);
  });

  it("同一行只保留一次", () => {
    const out = parseFindings(
      {
        issues: [
          { line: 3, kind: "spelling", suggestion: "receive", reason: "a" },
          { line: 3, kind: "wordform", reason: "b" },
        ],
      },
      known,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestion).toBe("receive");
  });

  it("建议与原词相同则丢弃建议，但保留问题", () => {
    const out = parseFindings(
      { issues: [{ line: 2, kind: "wordform", suggestion: "abandon", reason: "x" }] },
      known,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestion).toBeUndefined();
  });

  it("行号是字符串时也能接受", () => {
    const out = parseFindings({ issues: [{ line: "2", kind: "spelling", reason: "x" }] }, known);
    expect(out).toHaveLength(1);
    expect(out[0]?.lineNo).toBe(2);
  });

  it("缺 reason 时给兜底文案", () => {
    const out = parseFindings({ issues: [{ line: 2, kind: "spelling" }] }, known);
    expect(out[0]?.reason).not.toBe("");
  });

  it("issues 不是数组时返回空", () => {
    expect(parseFindings({ issues: "无" }, known)).toHaveLength(0);
    expect(parseFindings({}, known)).toHaveLength(0);
    expect(parseFindings(null, known)).toHaveLength(0);
  });

  it("结果按行号升序", () => {
    const out = parseFindings(
      {
        issues: [
          { line: 3, kind: "spelling", reason: "x" },
          { line: 1, kind: "spelling", reason: "y" },
        ],
      },
      known,
    );
    expect(out.map((f) => f.lineNo)).toEqual([1, 3]);
  });
});

describe("normalizeBaseUrl", () => {
  it("去掉末尾斜杠", () => {
    expect(normalizeBaseUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com");
  });

  it("保留 /v1 这类路径", () => {
    expect(normalizeBaseUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });

  it("非法值回落默认", () => {
    expect(normalizeBaseUrl("")).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(normalizeBaseUrl("不是网址")).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(normalizeBaseUrl("ftp://x.com")).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(normalizeBaseUrl(null)).toBe(DEFAULT_AI_CONFIG.baseUrl);
  });
});

describe("normalizeAiConfig", () => {
  it("默认关闭且没有 Key", () => {
    const cfg = normalizeAiConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBe("");
    expect(cfg.model).toBe("deepseek-chat");
  });

  it("接受字符串形式的布尔", () => {
    expect(normalizeAiConfig({ enabled: "true" }).enabled).toBe(true);
    expect(normalizeAiConfig({ enabled: "0" }).enabled).toBe(false);
  });

  it("空模型名回落默认", () => {
    expect(normalizeAiConfig({ model: "   " }).model).toBe("deepseek-chat");
  });

  it("从设置表读出配置", () => {
    const cfg = aiConfigFromSettings({
      ai_enabled: "true",
      ai_api_key: "sk-test",
      ai_base_url: "https://api.deepseek.com",
      ai_model: "deepseek-chat",
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe("sk-test");
  });
});

describe("canRunCheck", () => {
  it("没开就不跑", () => {
    const g = canRunCheck({ ...DEFAULT_AI_CONFIG, apiKey: "sk-x" });
    expect(g.ready).toBe(false);
  });

  it("开了但没 Key 也不跑", () => {
    const g = canRunCheck({ ...DEFAULT_AI_CONFIG, enabled: true });
    expect(g.ready).toBe(false);
  });

  it("开了且有 Key 才跑", () => {
    const g = canRunCheck({ ...DEFAULT_AI_CONFIG, enabled: true, apiKey: "sk-x" });
    expect(g.ready).toBe(true);
  });
});

describe("completionsUrl", () => {
  it("拼接路径", () => {
    expect(completionsUrl("https://api.deepseek.com")).toBe(
      "https://api.deepseek.com/chat/completions",
    );
  });

  it("已经带完整路径时不重复拼", () => {
    expect(completionsUrl("https://x.com/v1/chat/completions")).toBe(
      "https://x.com/v1/chat/completions",
    );
  });
});

describe("prompt", () => {
  it("凡是提到释义/中文的句子，都必须是「不要…」的禁令（§4.7 红线）", () => {
    // 直接断言「不含释义」太糙：prompt 里必然要写「不要给中文释义」这句禁令，
    // 让它自己命中。真正要保证的是——没有任何一条是「要求生成」的语气。
    const sensitive = /释义|中文/;
    const lines = SYSTEM_PROMPT.split("\n").filter((l) => sensitive.test(l));

    // 至少存在禁令，否则说明我们根本没守住这条边界
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      // 每个触及敏感词的句子都必须是禁止性表述
      expect(line).toMatch(/不要|禁止|严禁/);
      // 不能出现「适合背诵」这类会诱导模型产出背诵稿的措辞
      expect(line).not.toMatch(/适合背诵|请给出|请生成|请提供/);
    }
  });

  it("整份 prompt 不出现诱导生成的动词", () => {
    const banned = ["适合背诵", "请给出", "请生成", "请提供", "帮我写"];
    for (const b of banned) {
      expect(SYSTEM_PROMPT.includes(b)).toBe(false);
    }
  });

  it("只发英文，不发中文释义", () => {
    const msg = buildUserMessage([
      { lineNo: 1, headword: "abandon" },
      { lineNo: 2, headword: "give up" },
    ]);
    expect(msg).toContain("1\tabandon");
    expect(msg).toContain("2\tgive up");
    // 送检结构里根本没有中文字段，这里断言一下不出现常见释义词
    expect(msg.includes("放弃")).toBe(false);
  });

  it("按大小切批", () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({ lineNo: i + 1, headword: `w${i}` }));
    expect(chunkLines(lines, 2)).toHaveLength(3);
    expect(chunkLines(lines, 2)[0]).toHaveLength(2);
    expect(chunkLines(lines, 2)[2]).toHaveLength(1);
  });

  it("批大小为 0 或负数时降级为 1，不死循环", () => {
    const lines = [{ lineNo: 1, headword: "a" }, { lineNo: 2, headword: "b" }];
    expect(chunkLines(lines, 0)).toHaveLength(2);
    expect(chunkLines(lines, -5)).toHaveLength(2);
  });

  it("空输入得到空批列表", () => {
    expect(chunkLines([], CHUNK_SIZE)).toHaveLength(0);
  });
});

describe("selectLinesForCheck", () => {
  it("跳过重复行和错误行", () => {
    const out = selectLinesForCheck([
      { lineNo: 1, headword: "abandon", action: "new" },
      { lineNo: 2, headword: "abandon", action: "duplicate" },
      { lineNo: 3, headword: "", action: "error" },
      { lineNo: 4, headword: "recieve", action: "new" },
    ]);
    expect(out.map((l) => l.lineNo)).toEqual([1, 4]);
  });

  it("同一个词只送一次", () => {
    const out = selectLinesForCheck([
      { lineNo: 1, headword: "Abandon", action: "new" },
      { lineNo: 2, headword: "abandon", action: "append" },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("indexFindings / toneOf", () => {
  const f = {
    lineNo: 1,
    headword: "recieve",
    kind: "spelling" as const,
    suggestion: "receive",
    reason: "ie 反了",
  };

  it("按行号建索引", () => {
    const idx = indexFindings([f]);
    expect(idx.get(1)).toEqual(f);
  });

  it("没有结果时 tone 是 unknown", () => {
    expect(toneOf(undefined)).toBe("unknown");
  });

  it("nonexistent 是 error，其它是 warn", () => {
    expect(toneOf(f)).toBe("warn");
    expect(toneOf({ ...f, kind: "nonexistent" as const })).toBe("error");
  });
});

describe("部分失败的语义（不得谎报安全）", () => {
  it("partialError 存在时 hasPartialError 为真", () => {
    const outcome = { ok: true as const, findings: [], partialError: "请求超时" };
    expect(hasPartialError(outcome)).toBe(true);
  });

  it("全部成功时 hasPartialError 为假", () => {
    const outcome = { ok: true as const, findings: [] };
    expect(hasPartialError(outcome)).toBe(false);
  });

  it("部分失败 + 有发现，结果仍然可用", () => {
    const outcome = {
      ok: true as const,
      findings: [
        {
          lineNo: 1,
          headword: "recieve",
          kind: "spelling" as const,
          reason: "x",
        },
      ],
      partialError: "请求超时",
    };
    expect(hasPartialError(outcome)).toBe(true);
    expect(outcome.findings).toHaveLength(1);
  });
});
