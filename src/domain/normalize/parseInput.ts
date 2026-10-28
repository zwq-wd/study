/**
 * 行式批量录入解析（开发文档 §4.1）
 *
 * 输入格式（按行解析，容错）：
 *   abandon 放弃；抛弃
 *   abandon\tv. 放弃
 *   abandon
 *
 * 规则：
 * 1. 每行一条。取第一个连续的 ASCII 字母序列（允许 - ' 和内部空格，如 used to）作为英文，
 *    其余部分作为中文释义
 * 2. 英文缺失 → 错误行，整行不落库
 * 3. 中文为空 → 允许落库（先建卡，释义后补），但结果里要提示
 * 4. 中文里若含 ；;，,/ 则拆成多个 L1 义项
 * 5. 去重：norm 已存在 → 不新建，转「追加义项」
 *
 * 本模块是纯函数：只按行解析，不碰数据库。和已有词条的比对由调用方（repo）完成。
 */
import { normalizeDisplay, normalizeHeadword } from "./headword.ts";

/** 中文释义的分隔符：；;，,/ */
const MEANING_SEPARATORS = /[；;，,/]/;

export interface ParsedLine {
  /** 原行号，从 1 开始 */
  lineNo: number;
  /** 原始行文本（trim 前），用于错误展示 */
  raw: string;
  /** 展示用英文（保留大小写） */
  headword: string;
  /** 归一化键 */
  norm: string;
  /** 拆好的 L1 义项，可能为空数组 */
  meanings: string[];
}

export interface ParseError {
  lineNo: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  lines: ParsedLine[];
  errors: ParseError[];
  /** 解析出英文但中文为空的行号 */
  noMeaning: number[];
  /** 空行数（忽略掉，不计入错误） */
  blankLines: number;
  /** 同一批输入内部重复的 norm（保留第一次出现，后续标 duplicateInInput） */
  duplicatesInInput: string[];
}

/** 词性标记：`v.` `n.` `adj.` `vt.` …… 出现在英文后面时是释义的一部分，不是短语的一部分。 */
const POS_MARKER = /^(v|n|adj|adv|vt|vi|prep|conj|pron|art|num|int|aux|pl|abbr|phr)\.?$/i;

/**
 * 从一行里切出英文和中文。
 *
 * 英文允许的形态：`abandon`、`used to`、`well-known`、`don't`。
 * 判定方式：
 *  - 跳过前导的 ASCII 空白/标点/数字（`1. abandon`、`* abandon` 都能解析）
 *  - 一旦先遇到非 ASCII 字符（中文在前），判为错误行
 *  - 英文起点必须是 ASCII 字母（`123 456` 这种纯数字行判为错误）
 *  - 英文内部允许字母/数字/'/-，以及「空格 + 后面还有字母」（支持 used to）；
 *    但 Tab 是显式分隔符，遇到即停；后面跟着词性标记（v. / n. / adj.）也即停
 */
function splitLine(text: string): { headword: string; rest: string } | null {
  const s = text.trim();
  if (s === "") return null;

  let i = 0;
  // 跳过前导的非字母 ASCII 字符（空白、标点、数字）
  while (i < s.length) {
    const ch = s[i] ?? "";
    if (/[A-Za-z]/.test(ch)) break;
    // 非 ASCII（中文等）先出现 → 英文在后，按规格判错
    if (ch.charCodeAt(0) > 127) return null;
    if (!/[\s\p{P}\p{S}0-9]/u.test(ch)) return null;
    i++;
  }

  const start = i;
  if (start >= s.length) return null;

  let lastAlpha = -1;

  while (i < s.length) {
    const ch = s[i] ?? "";
    if (/[A-Za-z0-9'\-]/.test(ch)) {
      i++;
      lastAlpha = i;
      continue;
    }
    // Tab 是显式分隔符：`abandon\tv. 放弃`
    if (ch === "\t") break;

    // 空白：只有在「后面还跟着字母、且不是词性标记」时才算英文内部（支持 used to）
    if (/\s/.test(ch)) {
      let j = i;
      while (j < s.length && /\s/.test(s[j] ?? "")) j++;
      const next = s[j] ?? "";
      if (!/[A-Za-z]/.test(next)) break;

      // 取出后面那个 token，看是不是词性标记
      let k = j;
      while (k < s.length && /[A-Za-z.]/.test(s[k] ?? "")) k++;
      const token = s.slice(j, k);
      if (POS_MARKER.test(token)) break;

      i = j;
      continue;
    }
    break;
  }

  if (lastAlpha <= start) return null;

  const headword = s.slice(start, lastAlpha);
  const rest = s.slice(lastAlpha).trim();
  return { headword, rest };
}

/** 把中文释义串按分隔符拆成多条义项，去空、去重（保序）。 */
export function splitMeanings(raw: string): string[] {
  const parts = raw
    .split(MEANING_SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/**
 * 解析整段粘贴文本。
 *
 * 注意：这里**不判断**「该词在数据库里是否已存在」——那是 repo 的活。
 * 本函数只负责把文本变成结构，并标出输入内部的重复。
 */
export function parseInput(raw: string): ParseResult {
  const result: ParseResult = {
    lines: [],
    errors: [],
    noMeaning: [],
    blankLines: 0,
    duplicatesInInput: [],
  };

  // 统一换行符；逐行处理，保留行号
  const textLines = raw.replace(/\r\n?/g, "\n").split("\n");
  const seenNorm = new Set<string>();

  for (let idx = 0; idx < textLines.length; idx++) {
    const line = textLines[idx] ?? "";
    const lineNo = idx + 1;

    if (line.trim() === "") {
      result.blankLines++;
      continue;
    }

    const split = splitLine(line);
    if (split === null) {
      result.errors.push({
        lineNo,
        raw: line,
        reason: "没有解析出英文单词",
      });
      continue;
    }

    const headword = normalizeDisplay(split.headword);
    const norm = normalizeHeadword(split.headword);

    if (headword === "" || norm === "") {
      result.errors.push({ lineNo, raw: line, reason: "没有解析出英文单词" });
      continue;
    }

    if (seenNorm.has(norm)) {
      if (!result.duplicatesInInput.includes(norm)) result.duplicatesInInput.push(norm);
    }
    seenNorm.add(norm);

    const meanings = splitMeanings(split.rest);
    if (meanings.length === 0) result.noMeaning.push(lineNo);

    result.lines.push({ lineNo, raw: line, headword, norm, meanings });
  }

  return result;
}
