/**
 * 游戏模式 · 今日池子（纯函数）
 *
 * 来源只有两个，和用户确认过的口径完全一致：
 *   1. 今天在复习页被标「背错了」的词（data 层用 listMissedToday 查）
 *   2. 今天新导入的词（data 层用 listTodayNewWords 查，按 created_at 划天）
 *
 * 不读 fsrs、不看到期、不写库。合并后去重，错词优先。
 */
import type { WordRow, SenseRow } from "../../data/types.ts";
import type { QuizPoolEntry } from "./types.ts";

export interface GamePool {
  /** 出题用的词条；已洗牌 */
  entries: QuizPoolEntry[];
  /** 其中来自「今天背错」的数量（结算页可能展示） */
  fromMissed: number;
  /** 其中来自「今天新导入」的数量 */
  fromNew: number;
}

/**
 * 挑一个词用来出题的释义。
 *
 * 只取 layer 1（当初录入的义项）。理由：L2 补充义项在 fsrs_reps >= 3 之前
 * 在复习页是不可见的（domain/senses.ts:23-35）。游戏虽然不结算，但一旦拿 L2
 * 出题，就等于把用户还没「复习满三次」的新释义提前泄出来 —— 和复习页的
 * 可见性规则打架。所以这里比复习页更严格：只用 L1。
 */
function pickMeaning(senses: readonly SenseRow[]): string | null {
  const l1 = senses
    .filter((s) => s.layer === 1)
    .sort((a, b) => {
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.id - b.id;
    });
  for (const s of l1) {
    const m = s.meaning_cn.trim();
    if (m.length > 0) return m;
  }
  return null;
}

/** 把一个词条转成出题条目；没有可用释义（L1 全空）时返回 null。 */
export function toPoolEntry(word: WordRow & { senses?: readonly SenseRow[] }): QuizPoolEntry | null {
  const senses = word.senses ?? [];
  const meaning = pickMeaning(senses);
  if (meaning === null) return null;
  const headword = word.headword.trim();
  if (headword.length === 0) return null;
  return { wordId: word.id, headword, meanings: [meaning] };
}

/**
 * 合并「今天背错」与「今天新导入」，去重后洗牌。
 *
 * 为什么错词优先：错词是今天已经证明「这个我不会」的词，比今天刚录进来
 * 还没被考过的词更值得在游戏里再撞一次。去重时保留错词那一份顺序在前。
 *
 * limit 为 0 / 非法时当作「不设上限」。洗牌只改出场顺序，不改选谁。
 */
export function buildGamePool(
  missed: readonly WordRow[],
  newWords: readonly WordRow[],
  limit: number,
  rng: () => number = Math.random,
): GamePool {
  const seen = new Set<number>();
  const merged: QuizPoolEntry[] = [];
  let fromMissed = 0;
  let fromNew = 0;

  const push = (word: WordRow, tag: "missed" | "new"): void => {
    if (seen.has(word.id)) return;
    const entry = toPoolEntry(word);
    if (entry === null) return;
    seen.add(word.id);
    merged.push(entry);
    if (tag === "missed") fromMissed += 1;
    else fromNew += 1;
  };

  for (const w of missed) push(w, "missed");
  for (const w of newWords) push(w, "new");

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : merged.length;
  const capped = merged.slice(0, safeLimit);

  return {
    entries: shuffle(capped, rng),
    fromMissed,
    fromNew,
  };
}

/** Fisher–Yates，返回新数组。与 scheduler/session.ts 的 shuffle 同实现，这里独立一份避免跨模块耦合。 */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
