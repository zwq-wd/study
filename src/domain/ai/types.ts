/**
 * AI 录入校对 —— 纯类型（开发文档 §4.7）
 *
 * 边界（硬约束）：AI 只当**校对员**，不生成任何要背的中文释义。
 * 它的输出只有「这一行的英文有问题」和「建议拼成什么」，没有释义、没有例句。
 *
 * 本目录零 IO、不联网、不碰 Date.now()，100% 可单测。
 */

/** 送去校对的一行。只发英文，不发中文释义 —— 少发就少泄露，也少花钱。 */
export interface CheckLine {
  lineNo: number;
  headword: string;
}

/** 问题类别。第一期只覆盖英文侧，不判断中英是否对得上。 */
export type CheckKind = "spelling" | "wordform" | "nonexistent";

/** 一条校对结果。只用于提示，绝不自动改写用户的录入。 */
export interface CheckFinding {
  /** 原行号，来自输入，模型不能凭空编 */
  lineNo: number;
  /** 该行当时的英文，用于在 UI 上回显 */
  headword: string;
  kind: CheckKind;
  /** 建议的正确拼写；模型没给就省略 */
  suggestion?: string;
  /** 一句话说明错在哪 */
  reason: string;
}

/**
 * 校对结果的外层。失败是**正常返回值**，不是异常 ——
 * 网络不通必须静默降级，不能阻塞任何本地功能（§4.7）。
 *
 * `partialError`：多批请求时，有的批成功、有的批失败。
 * 成功的结果照样给用户，但必须**明说**有一批没跑成，
 * 否则 UI 会把「没查到问题」误报成「没有问题」——那是谎报安全。
 */
export type CheckOutcome =
  | { ok: true; findings: CheckFinding[]; partialError?: string }
  | { ok: false; reason: string };

/** 这一批是否经历过「部分失败」。 */
export function hasPartialError(outcome: Extract<CheckOutcome, { ok: true }>): boolean {
  return outcome.partialError !== undefined;
}
