/**
 * AI 客户端的行为测试（开发文档 §4.7）
 *
 * 这里**不联网**：把 plugin-http 的 fetch 换成替身，验证「失败怎么降级」
 * 「部分失败怎么报」「成功结果怎么收敛」这些真正会出事的路径。
 *
 * 为什么值得单独测：`check()` 是唯一会把模型输出带进 UI 的地方，
 * 它一旦把失败吞掉，用户就会以为「没发现问题」——那是谎报安全。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// 必须在 import client 之前完成替身，client 在模块顶层引入了 plugin-http
const fetchMock = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

const { TauriAiClient } = await import("../src/data/ai/client.ts");

/** 造一个只有 loadSettings/saveSettings 的设置源。 */
function makeSettings(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    loadSettings: async () => ({ ...store }),
    saveSettings: async (patch: Record<string, string>) => {
      Object.assign(store, patch);
    },
  };
}

function enabledSettings(extra: Record<string, string> = {}) {
  return makeSettings({
    ai_enabled: "true",
    ai_api_key: "sk-test",
    ai_base_url: "https://api.deepseek.com",
    ai_model: "deepseek-chat",
    ...extra,
  });
}

/** 造一个 OpenAI 兼容的响应。 */
function chatResponse(content: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TauriAiClient 门禁", () => {
  it("没开启时不发请求", async () => {
    const client = new TauriAiClient(makeSettings({ ai_enabled: "false", ai_api_key: "sk-x" }));
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("开启了但没 Key 时不发请求", async () => {
    const client = new TauriAiClient(makeSettings({ ai_enabled: "true" }));
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空输入直接成功，不浪费一次请求", async () => {
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([]);
    expect(r).toEqual({ ok: true, findings: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TauriAiClient 正常路径", () => {
  it("解析出问题并回填原词", async () => {
    fetchMock.mockResolvedValue(
      chatResponse(
        '{"issues":[{"line":1,"headword":"acommodate","kind":"spelling","suggestion":"accommodate","reason":"少一个 m"}]}',
      ),
    );

    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "acommodate" }]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.suggestion).toBe("accommodate");
    expect(r.findings[0]?.headword).toBe("acommodate");
    expect(r.partialError).toBeUndefined();
  });

  it("请求发到正确的地址并带上 Authorization", async () => {
    fetchMock.mockResolvedValue(chatResponse('{"issues":[]}'));
    const client = new TauriAiClient(enabledSettings());
    await client.check([{ lineNo: 1, headword: "abandon" }]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("只发英文，请求体里不含中文释义", async () => {
    fetchMock.mockResolvedValue(chatResponse('{"issues":[]}'));
    const client = new TauriAiClient(enabledSettings());
    await client.check([{ lineNo: 1, headword: "abandon" }]);

    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    const sent = JSON.parse(init.body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = sent.messages.find((m) => m.role === "user");
    expect(user?.content).toContain("abandon");
    expect(user?.content).not.toMatch(/放弃|抛弃/);
  });

  it("模型套了 markdown 围栏也能解析", async () => {
    fetchMock.mockResolvedValue(
      chatResponse('```json\n{"issues":[{"line":1,"kind":"spelling","reason":"x"}]}\n```'),
    );
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "recieve" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.findings).toHaveLength(1);
  });
});

describe("TauriAiClient 失败降级", () => {
  it("401 说 Key 无效，不抛异常", async () => {
    fetchMock.mockResolvedValue(chatResponse("", 401));
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Key");
  });

  it("429 说频繁或余额不足", async () => {
    fetchMock.mockResolvedValue(chatResponse("", 429));
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
  });

  it("网络异常不抛出，转成原因", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("network down");
  });

  it("超时说「请求超时」", async () => {
    const err = new Error("x");
    err.name = "TimeoutError";
    fetchMock.mockRejectedValue(err);
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("请求超时");
  });

  it("返回非 JSON 时降级", async () => {
    fetchMock.mockResolvedValue(chatResponse("模型不想干活"));
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("JSON");
  });

  it("响应结构缺 choices 时降级", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const client = new TauriAiClient(enabledSettings());
    const r = await client.check([{ lineNo: 1, headword: "abandon" }]);
    expect(r.ok).toBe(false);
  });
});

describe("TauriAiClient 多批与部分失败", () => {
  it("超过 CHUNK_SIZE 会切批并发起多次请求", async () => {
    fetchMock.mockImplementation(async () => chatResponse('{"issues":[]}'));
    const client = new TauriAiClient(enabledSettings());
    const lines = Array.from({ length: 41 }, (_, i) => ({
      lineNo: i + 1,
      headword: `word${i}`,
    }));
    await client.check(lines);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("一批成功一批失败：结果可用，但带 partialError（不谎报安全）", async () => {
    fetchMock
      .mockResolvedValueOnce(chatResponse('{"issues":[]}'))
      .mockRejectedValueOnce(new Error("超时了"));

    const client = new TauriAiClient(enabledSettings());
    const lines = Array.from({ length: 41 }, (_, i) => ({
      lineNo: i + 1,
      headword: `word${i}`,
    }));
    const r = await client.check(lines);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.partialError).toBeDefined();
      expect(r.partialError).toContain("超时");
    }
  });

  it("所有批都失败才算整体失败", async () => {
    fetchMock.mockRejectedValue(new Error("全挂了"));
    const client = new TauriAiClient(enabledSettings());
    const lines = Array.from({ length: 41 }, (_, i) => ({
      lineNo: i + 1,
      headword: `word${i}`,
    }));
    const r = await client.check(lines);
    expect(r.ok).toBe(false);
  });
});

describe("TauriAiClient 配置读写", () => {
  it("saveConfig 写的键能被 loadConfig 读回", async () => {
    const s = makeSettings();
    const client = new TauriAiClient(s);

    await client.saveConfig({
      enabled: true,
      apiKey: "sk-round-trip",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
    });

    const back = await client.loadConfig();
    expect(back.enabled).toBe(true);
    expect(back.apiKey).toBe("sk-round-trip");
  });

  it("读设置抛异常时静默返回未配置，不影响本地功能", async () => {
    const client = new TauriAiClient({
      loadSettings: async () => {
        throw new Error("db broken");
      },
      saveSettings: async () => {},
    });
    const cfg = await client.loadConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBe("");
  });
});
