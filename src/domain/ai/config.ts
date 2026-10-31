/**
 * 校对配置的收敛与门禁（开发文档 §4.5 / §4.7）
 *
 * 和 scheduler/config.ts 同一路数：任何来源（数据库、导入的 JSON）来的值
 * 都先过这里，越界夹到边界，缺省回默认。
 *
 * 默认**关闭**。没配 Key 就永远调不动 —— 这是「AI 不阻塞本地功能」的底线。
 */

export interface AiConfig {
  /** 总开关，默认关 */
  enabled: boolean;
  /** 用户填的 Key，空串 = 没配 */
  apiKey: string;
  /** 端点，默认 DeepSeek */
  baseUrl: string;
  /** 模型名，默认 deepseek-chat */
  model: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  apiKey: "",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
};

/** 设置表里的键名。统一 ai_ 前缀，导出时会被整体剔掉（repo.exportAll）。 */
export const AI_SETTING_KEYS = {
  enabled: "ai_enabled",
  apiKey: "ai_api_key",
  baseUrl: "ai_base_url",
  model: "ai_model",
} as const;

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return fallback;
}

/** 端点收敛：只接受 http/https，去掉末尾斜杠。非法值回落默认。 */
export function normalizeBaseUrl(raw: unknown): string {
  const s = asString(raw)?.trim() ?? "";
  if (s === "") return DEFAULT_AI_CONFIG.baseUrl;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return DEFAULT_AI_CONFIG.baseUrl;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return DEFAULT_AI_CONFIG.baseUrl;
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** 把设置表的原始字符串收敛成 AiConfig。 */
export function normalizeAiConfig(
  partial: Partial<Record<"enabled" | "apiKey" | "baseUrl" | "model", unknown>>,
): AiConfig {
  const model = asString(partial.model)?.trim() ?? "";

  return {
    enabled: asBool(partial.enabled, DEFAULT_AI_CONFIG.enabled),
    apiKey: asString(partial.apiKey)?.trim() ?? "",
    baseUrl: normalizeBaseUrl(partial.baseUrl),
    model: model === "" ? DEFAULT_AI_CONFIG.model : model,
  };
}

/** 能不能真的发起请求。不能的话给出给用户看的原因。 */
export type AiGate = { ready: true } | { ready: false; reason: string };

export function canRunCheck(cfg: AiConfig): AiGate {
  if (!cfg.enabled) return { ready: false, reason: "AI 校对未开启" };
  if (cfg.apiKey === "") return { ready: false, reason: "还没有填 API Key" };
  return { ready: true };
}

/** 设置表键 → AiConfig 的读取。纯映射，不碰数据库。 */
export function aiConfigFromSettings(rows: Record<string, string>): AiConfig {
  return normalizeAiConfig({
    enabled: rows[AI_SETTING_KEYS.enabled],
    apiKey: rows[AI_SETTING_KEYS.apiKey],
    baseUrl: rows[AI_SETTING_KEYS.baseUrl],
    model: rows[AI_SETTING_KEYS.model],
  });
}

/** chat/completions 的完整地址。端点可能已经带了 /v1。 */
export function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}
