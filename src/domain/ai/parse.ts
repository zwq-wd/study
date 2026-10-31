/**
 * 模型响应的解析与校验（开发文档 §4.7、硬性约束 4）
 *
 * 跨边界数据一律先当 unknown，手写 parse，禁止 any 和盲目断言。
 * 模型是**不可信输入源**：它会少给字段、多给字段、给错类型、
 * 编造不存在的行号、套一层 markdown 代码块。这些都必须在这里挡住。
 */
import type { CheckFinding, CheckKind } from "./types.ts";

const KINDS: readonly CheckKind[] = ["spelling", "wordform", "nonexistent"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asKind(v: unknown): CheckKind | null {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v)
    ? (v as CheckKind)
    : null;
}

/**
 * 从模型返回的正文里抠出 JSON 对象。
 *
 * 模型常无视「不要 markdown 代码块」的规定，包一层 ```json ```。
 * 这里做最小清洗：去掉围栏，然后取第一个 { 到最后一个 } 的子串。
 * 解析失败返回 null —— 由调用方降级成「本次未校对」，绝不抛给用户。
 */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== "string") return null;

  let s = text.trim();

  // 去掉 ```json ... ``` 或 ``` ... ``` 围栏
  const fence = /^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```$/;
  const m = fence.exec(s);
  if (m !== null && typeof m[1] === "string") s = m[1].trim();

  // 仍然不是纯 JSON 时，退一步截取首个 { 到末个 } 之间
  if (!s.startsWith("{")) {
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    s = s.slice(first, last + 1);
  }

  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

/**
 * 把解析后的对象收敛成 findings。
 *
 * 关键防线：**行号必须在本次送检的集合里**。
 * 模型偶尔会幻觉出 `line: 999`，如果照单全收，UI 就会指向一个不存在的行。
 * `known` 是这一批实际发出去的行号 → 英文映射。
 */
export function parseFindings(
  payload: unknown,
  known: ReadonlyMap<number, string>,
): CheckFinding[] {
  if (!isRecord(payload)) return [];
  const raw = payload["issues"];
  if (!Array.isArray(raw)) return [];

  const out: CheckFinding[] = [];
  const seenLine = new Set<number>();

  for (const item of raw) {
    if (!isRecord(item)) continue;

    const line = typeof item["line"] === "number" ? item["line"] : Number(item["line"]);
    if (!Number.isInteger(line)) continue;

    // 只认本次真的送出去的行；同一行只报一次
    const original = known.get(line);
    if (original === undefined) continue;
    if (seenLine.has(line)) continue;

    const kind = asKind(item["kind"]);
    if (kind === null) continue;

    const reason = typeof item["reason"] === "string" ? item["reason"].trim() : "";

    const suggestionRaw = item["suggestion"];
    const suggestion =
      typeof suggestionRaw === "string" && suggestionRaw.trim() !== ""
        ? suggestionRaw.trim()
        : undefined;

    // 建议与原文完全一致 = 没有建议，丢掉，避免 UI 上出现「改成一样的」
    const usefulSuggestion =
      suggestion !== undefined && suggestion.toLowerCase() !== original.toLowerCase()
        ? suggestion
        : undefined;

    seenLine.add(line);
    out.push({
      lineNo: line,
      headword: original,
      kind,
      reason: reason === "" ? "模型认为这一行有问题" : reason,
      ...(usefulSuggestion !== undefined ? { suggestion: usefulSuggestion } : {}),
    });
  }

  // 按行号排序，UI 直接从上往下读
  out.sort((a, b) => a.lineNo - b.lineNo);
  return out;
}

/** 从 OpenAI 兼容的 chat 响应里取出正文。取不到就是失败，返回 null。 */
export function extractContent(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first["message"];
  if (!isRecord(message)) return null;

  const content = message["content"];
  return typeof content === "string" ? content : null;
}
