/**
 * 校对用 Prompt（开发文档 §4.7）
 *
 * 红线：Prompt 里**禁止**出现「请给出适合背诵的简洁释义」这类措辞。
 * 本项目更进一步 —— 只在**英文侧**做校对，从头到尾不问词义，
 * 这样「AI 提前泄题」的风险在结构上根本不存在（§11.2 R9）。
 */
import type { CheckLine } from "./types.ts";

export const SYSTEM_PROMPT = [
  "你是一个英语词条录入校对员。用户会给你一批英语单词或短语，每行开头是行号。",
  "你的唯一任务：找出其中拼写错误、词形错误、或根本不是英语词的条目。",
  "",
  "kind 只能是以下三种之一：",
  '- "spelling"：拼写错误，比如 acommodate → accommodate',
  '- "wordform"：词形不对，比如把不可数名词写了复数、大小写明显误写',
  '- "nonexistent"：不是一个真实的英语词',
  "",
  "严格禁止：",
  "- 不要解释词义，不要给中文释义",
  "- 不要生成例句或用法",
  "- 不要评价这个词该不该背、好不好背",
  "- 正确的词一律不要报告（专有名词、缩写、习语、短语动词都算正确）",
  "",
  '只输出 JSON，不要 markdown 代码块，不要任何解释文字。格式：{"issues":[{"line":1,"headword":"acommodate","kind":"spelling","suggestion":"accommodate","reason":"少一个 m"}]}',
  '没有问题时输出 {"issues":[]}。',
].join("\n");

/**
 * 把若干行拼成一条 user 消息。
 * 只发行号和英文，中文释义一个字节都不发。
 */
export function buildUserMessage(lines: readonly CheckLine[]): string {
  const body = lines.map((l) => `${l.lineNo}\t${l.headword}`).join("\n");
  return `请校对下面这些英文词条，行首数字是行号：\n${body}`;
}

/** 单次请求最多校多少行。太大容易超时，也太贵。 */
export const CHUNK_SIZE = 40;

/**
 * 切批。纯函数：不关心内容，只按大小切。
 * 用途是一次录入几百个词时拆成多个请求，单个失败不影响其它批。
 */
export function chunkLines(lines: readonly CheckLine[], size: number): CheckLine[][] {
  const n = Math.max(1, Math.floor(size));
  const out: CheckLine[][] = [];
  for (let i = 0; i < lines.length; i += n) {
    out.push(lines.slice(i, i + n));
  }
  return out;
}
