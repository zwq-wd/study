/**
 * 把校对结果挂回录入计划（开发文档 §4.1 / §4.7）
 *
 * 只做「标注」，不改任何 decision 的 action 或 meanings。
 * 用户必须自己决定改不改 —— 这是「只提示，我自己改」的落地方式。
 */
import type { CheckFinding } from "./types.ts";

/** UI 拿到的一份「行号 → 问题」。 */
export type FindingIndex = ReadonlyMap<number, CheckFinding>;

export function indexFindings(findings: readonly CheckFinding[]): FindingIndex {
  const m = new Map<number, CheckFinding>();
  for (const f of findings) {
    // 同一行若有多条，保留第一条（parse 已按行去重，这里再兜一次）
    if (!m.has(f.lineNo)) m.set(f.lineNo, f);
  }
  return m;
}

/**
 * 从解析出的行里抽出要送检的内容。
 *
 * 只送新词和有意义的行：
 *  - 错误行（没解析出英文）没有 headword，送了也是浪费
 *  - 重复行（本批内重复）已经在预览里标出来了，AI 再说一遍没有增量信息
 */
export function selectLinesForCheck(
  decisions: ReadonlyArray<{ lineNo: number; headword: string; action: string }>,
): Array<{ lineNo: number; headword: string }> {
  const seen = new Set<string>();
  const out: Array<{ lineNo: number; headword: string }> = [];

  for (const d of decisions) {
    if (d.action === "duplicate" || d.action === "error") continue;
    const hw = d.headword.trim();
    if (hw === "") continue;

    // 同一个词在一批里出现多次只送一次，省 token
    const key = hw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ lineNo: d.lineNo, headword: hw });
  }

  return out;
}

/** 一行最终显示什么颜色/文案。 */
export type CheckTone = "ok" | "warn" | "error" | "unknown";

export function toneOf(finding: CheckFinding | undefined): CheckTone {
  if (finding === undefined) return "unknown";
  if (finding.kind === "nonexistent") return "error";
  return "warn";
}
