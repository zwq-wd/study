/**
 * 游戏模式 · 出题（纯函数）
 *
 * 两个方向随机交替：
 *   - en2cn：题面是英文，四个选项是中文释义
 *   - cn2en：题面是中文释义，四个选项是英文 headword
 *
 * 干扰项来自全库（data 层传入的候选池），并做一层「防重叠」过滤：
 * 随机抽到的释义如果和正确答案意思太近，这题就有两个正确答案 —— 用户没见过
 * 自己的词库里到底有多少同义词，但「放弃 / 抛弃」这种撞车一定会被骂。所以宁可重抽。
 */
import { DISTRACTOR_RETRY_LIMIT, NO_REPEAT_WINDOW } from "./config.ts";
import type {
  DistractorCandidate,
  GameOption,
  GameQuestion,
  QuizDirection,
  QuizPoolEntry,
} from "./types.ts";
import { shuffle } from "./pool.ts";

/** 中文释义的归一化：去掉标点、空白、括号内容，便于比较 */
function normalizeMeaning(text: string): string {
  return text
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s，。、；：！？,.;:!?\-—…·"“”'‘’]/g, "")
    .trim();
}

/** 最长公共子串长度 —— 用来判断两个释义是不是「同一个意思换个说法」 */
function commonSubstring(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] ?? 0;
      prev[j] = a.charAt(i - 1) === b.charAt(j - 1) ? diag + 1 : 0;
      diag = tmp;
      const cell = prev[j] ?? 0;
      if (cell > best) best = cell;
    }
  }
  return best;
}

/**
 * 两个中文释义是不是「太像了」。
 *
 * 判定：归一化后互相包含，或最长公共子串 >= 2 个汉字。
 * 2 个汉字是个刻意的低阈值：中文双字词占绝大多数，共享两个连续汉字
 * （「放弃」vs「抛弃」共享「弃」只有 1，但「放弃」vs「放弃；抛弃」是包含）
 * 已经足够说明这两个选项在字面上纠缠在一起。
 */
export function meaningsTooSimilar(a: string, b: string): boolean {
  const na = normalizeMeaning(a);
  const nb = normalizeMeaning(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  if (na.length >= 2 && nb.includes(na)) return true;
  if (nb.length >= 2 && na.includes(nb)) return true;
  return commonSubstring(na, nb) >= 2;
}

/** 英文 headword 是不是太像（大小写不敏感、去掉空格后相等或互相包含） */
export function headwordsTooSimilar(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (na.length === 0 || nb.length === 0) return false;
  if (na === nb) return true;
  // 「abandon」vs「abandoned」这种词形变化，前 4 个字母相同就当作太像
  const head = Math.min(4, na.length, nb.length);
  return head >= 4 && na.slice(0, head) === nb.slice(0, head);
}

export interface BuildQuestionInput {
  entry: QuizPoolEntry;
  /** 全库候选，data 层一次查好传进来 */
  candidates: readonly DistractorCandidate[];
  direction: QuizDirection;
  /** 最近出过的词 id，用于避免相邻重复 */
  recentWordIds?: readonly number[];
  rng?: () => number;
}

/**
 * 生成一道四选一。
 *
 * 候选池里凑不出 3 个合格干扰项时返回 null —— 调用方负责跳过这个词。
 * 宁可少出一道题，也不要出一道「两个正确答案」或「三个明显无关选项」的题。
 */
export function buildQuestion(input: BuildQuestionInput): GameQuestion | null {
  const rng = input.rng ?? Math.random;
  const { entry, candidates, direction } = input;

  const meaning = entry.meanings[0] ?? "";
  const correctText = direction === "en2cn" ? meaning : entry.headword;
  // 中→英时题面是中文释义、正确选项是英文；两个方向都必须有「题面」和「答案」两段文本。
  const promptText = direction === "en2cn" ? entry.headword : meaning;
  if (correctText.length === 0 || promptText.length === 0) return null;

  const picked = new Map<string, string>();
  let attempts = 0;

  while (picked.size < 3 && attempts < DISTRACTOR_RETRY_LIMIT) {
    attempts += 1;
    const cand = candidates[Math.floor(rng() * candidates.length)];
    if (cand === undefined) break;
    if (cand.wordId === entry.wordId) continue;

    const text = direction === "en2cn" ? cand.meaningCn : cand.headword;
    if (text.length === 0) continue;

    const tooSimilarToCorrect =
      direction === "en2cn"
        ? meaningsTooSimilar(text, correctText)
        : headwordsTooSimilar(text, correctText);
    if (tooSimilarToCorrect) continue;

    let clashesExisting = false;
    for (const existing of picked.values()) {
      const clash =
        direction === "en2cn"
          ? meaningsTooSimilar(text, existing)
          : headwordsTooSimilar(text, existing);
      if (clash) {
        clashesExisting = true;
        break;
      }
    }
    if (clashesExisting) continue;

    picked.set(text, text);
  }

  if (picked.size < 3) return null;

  const options: GameOption[] = [
    { id: "correct", text: correctText, correct: true },
    ...[...picked.values()].map((text, i) => ({ id: "d" + String(i), text, correct: false })),
  ];
  const shuffled = shuffle(options, rng);
  const correctIndex = shuffled.findIndex((o) => o.correct);
  if (correctIndex < 0) return null;

  return {
    direction,
    wordId: entry.wordId,
    headword: entry.headword,
    prompt: promptText,
    options: shuffled,
    correctIndex,
  };
}

/**
 * 从池子里挑下一个出题的词。
 *
 * 顺序游标 + 最近 N 题不重复。走到池子末尾就回到 0（循环模式）——
 * 用户明确要求「答完就从头再抽，越玩越熟」，所以不做「今天通关」这种终点。
 */
export function nextEntry(
  pool: readonly QuizPoolEntry[],
  cursor: number,
  recentWordIds: readonly number[],
): { entry: QuizPoolEntry | null; cursor: number } {
  if (pool.length === 0) return { entry: null, cursor: 0 };

  const window = new Set(recentWordIds.slice(-NO_REPEAT_WINDOW));
  for (let step = 0; step < pool.length; step++) {
    const idx = (cursor + step) % pool.length;
    const entry = pool[idx];
    if (entry === undefined) continue;
    if (window.has(entry.wordId)) continue;
    return { entry, cursor: (idx + 1) % pool.length };
  }

  // 全被窗口挡住（池子比窗口还小）：退化成不判重
  const idx = cursor % pool.length;
  const fallback = pool[idx] ?? null;
  return { entry: fallback, cursor: (idx + 1) % pool.length };
}

/** 掷一次方向。rng 可注入，测试能固定。 */
export function pickDirection(rng: () => number = Math.random): QuizDirection {
  return rng() < 0.5 ? "en2cn" : "cn2en";
}