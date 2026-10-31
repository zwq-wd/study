/**
 * AI 校对客户端（开发文档 §4.7）
 *
 * 位置说明：这是 **IO 层**，不是 domain —— 它会联网、会抛异常、会读时钟。
 * 所以它必须在 `src/data/` 下，不能放进 `src/domain/`（硬性约束 1）。
 * 所有纯逻辑（prompt、解析、合并、配置收敛）都在 `domain/ai/` 里。
 *
 * 三条工程红线（§4.7）：
 * 1. 失败必须静默降级 —— 网络不通只返回原因，绝不抛给 UI 阻塞录入
 * 2. 不发中文释义 —— 只把英文发出去
 * 3. 不生成要背的内容 —— 只回「这行有问题」和「建议拼成什么」
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  aiConfigFromSettings,
  canRunCheck,
  completionsUrl,
  type AiConfig,
  type AiGate,
} from "../../domain/ai/config.ts";
import { SYSTEM_PROMPT, buildUserMessage, CHUNK_SIZE, chunkLines } from "../../domain/ai/prompt.ts";
import { extractContent, extractJsonObject, parseFindings } from "../../domain/ai/parse.ts";
import type { CheckFinding, CheckLine, CheckOutcome } from "../../domain/ai/types.ts";

/** 单次请求超时。校对是交互式操作，超过这个时间用户已经在等下一个动作了。 */
const TIMEOUT_MS = 30_000;

/**
 * 超时信号。`AbortSignal.timeout` 要 WebView2 ≥ 103（本机 155 没问题），
 * 但别人机器上可能更旧；拿不到就退回手动 AbortController + setTimeout，
 * 保证不会因为一个 API 缺失就把整条校对链路打挂。
 */
function timeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const withTimeout = (AbortSignal as unknown as { timeout?: (n: number) => AbortSignal }).timeout;
  if (typeof withTimeout === "function") {
    return { signal: withTimeout.call(AbortSignal, ms), cancel: () => {} };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(timer) };
}

export interface AiClient {
  /** 当前配置（每次现读，用户在设置页改完立刻生效） */
  loadConfig(): Promise<AiConfig>;
  /** 保存配置 */
  saveConfig(cfg: AiConfig): Promise<void>;
  /** 能不能跑，不能的话给原因 */
  gate(): Promise<AiGate>;
  /** 校对一批词；失败的批不影响成功的批 */
  check(lines: readonly CheckLine[]): Promise<CheckOutcome>;
}

/** 从设置表读配置需要的最小接口，避免 data 层之间互相 import 实体类。 */
export interface SettingsSource {
  loadSettings(): Promise<Record<string, string>>;
  saveSettings(patch: Record<string, string>): Promise<void>;
}

export class TauriAiClient implements AiClient {
  constructor(private readonly settings: SettingsSource) {}

  async loadConfig(): Promise<AiConfig> {
    try {
      const rows = await this.settings.loadSettings();
      return aiConfigFromSettings(rows);
    } catch {
      // 读设置失败就当没配，AI 静默不可用，本地功能照常
      return aiConfigFromSettings({});
    }
  }

  async saveConfig(cfg: AiConfig): Promise<void> {
    await this.settings.saveSettings({
      ai_enabled: cfg.enabled ? "true" : "false",
      ai_api_key: cfg.apiKey,
      ai_base_url: cfg.baseUrl,
      ai_model: cfg.model,
    });
  }

  async gate(): Promise<AiGate> {
    return canRunCheck(await this.loadConfig());
  }

  async check(lines: readonly CheckLine[]): Promise<CheckOutcome> {
    if (lines.length === 0) return { ok: true, findings: [] };

    const cfg = await this.loadConfig();
    const g = canRunCheck(cfg);
    if (!g.ready) return { ok: false, reason: g.reason };

    const chunks = chunkLines(lines, CHUNK_SIZE);
    const findings: CheckFinding[] = [];
    let firstError: string | null = null;
    let okChunks = 0;

    for (const chunk of chunks) {
      const r = await this.checkChunk(cfg, chunk);
      if (r.ok) {
        okChunks++;
        findings.push(...r.findings);
      } else if (firstError === null) {
        firstError = r.reason;
      }
    }

    // 判定依据是「有没有成功的批次」，不是「有没有发现」。
    // 用 findings.length 会把「成功但没发现问题」误判成整体失败。
    if (okChunks === 0) {
      return { ok: false, reason: firstError ?? "校对失败" };
    }
    return firstError === null
      ? { ok: true, findings }
      : { ok: true, findings, partialError: firstError };
  }

  private async checkChunk(cfg: AiConfig, chunk: readonly CheckLine[]): Promise<CheckOutcome> {
    const known = new Map<number, string>();
    for (const l of chunk) known.set(l.lineNo, l.headword);

    const body = {
      model: cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(chunk) },
      ],
      temperature: 0,
      stream: false,
    };

    let text: string;
    const t = timeoutSignal(TIMEOUT_MS);
    try {
      const res = await tauriFetch(completionsUrl(cfg.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: t.signal,
      });

      if (!res.ok) {
        return { ok: false, reason: httpReason(res.status) };
      }

      const payload: unknown = await res.json();
      const content = extractContent(payload);
      if (content === null) {
        return { ok: false, reason: "模型没有返回内容" };
      }
      text = content;
    } catch (e) {
      return { ok: false, reason: networkReason(e) };
    } finally {
      t.cancel();
    }

    const parsed = extractJsonObject(text);
    if (parsed === null) {
      return { ok: false, reason: "模型返回的不是 JSON" };
    }

    return { ok: true, findings: parseFindings(parsed, known) };
  }
}

/** HTTP 状态码 → 给用户看的中文原因。不泄露响应体（可能含 Key 回显）。 */
function httpReason(status: number): string {
  if (status === 401 || status === 403) return "API Key 无效或没有权限";
  if (status === 429) return "请求太频繁或余额不足";
  if (status === 402) return "账户余额不足";
  if (status >= 500) return "服务端出错了";
  return `请求失败（HTTP ${status}）`;
}

/** 网络异常 → 中文原因。超时单独说，因为它最常发生。 */
function networkReason(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "请求超时";
    const msg = e.message;
    if (msg.includes("timed out") || msg.includes("timeout")) return "请求超时";
    // 只取第一行，避免把整段栈塞进 UI
    const first = msg.split("\n")[0] ?? "";
    return first === "" ? "网络不通" : first;
  }
  return "网络不通";
}
