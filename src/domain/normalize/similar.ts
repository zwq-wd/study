/**
 * 疑似重复检测（开发文档 §4.1.3）
 *
 * 本项目**主动不做**词形归并。但录入时若 norm 与某个已存在词条
 * 「编辑距离 ≤ 1 且词根相同（去掉 -s/-ed/-ing/-ly 后相等）」，
 * 就提示「可能重复：abandon（已存在）」，由用户决定合并还是新建。
 * **提示，不自动改。**
 */

/** 只用来掐词尾，不追求语言学正确性 —— 宁可多提示，不可自动合并。 */
const SUFFIXES = ["ing", "ed", "ies", "es", "ly", "s", "d"] as const;

export function stemOf(word: string): string {
  const w = word.toLowerCase();

  // 先处理重复辅音 + ing/ed：running → runn → run；stopped → stopp → stop
  for (const suf of ["ing", "ed"] as const) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      let base = w.slice(0, -suf.length);
      if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
        base = base.slice(0, -1);
      }
      return base;
    }
  }

  // 长后缀优先：studies → study（不能先被 -s 吃掉变成 studie）
  for (const suf of SUFFIXES) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) {
      let base = w.slice(0, -suf.length);
      if (suf === "ies") base = `${base}y`;
      return base;
    }
  }

  return w;
}

/** Levenshtein 距离，带早停：超过 limit 就返回 limit+1。 */
export function editDistance(a: string, b: string, limit = 1): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0] ?? 0;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prev[j] ?? 0) + 1;
      const ins = (cur[j - 1] ?? 0) + 1;
      const sub = (prev[j - 1] ?? 0) + cost;
      const v = Math.min(del, ins, sub);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] ?? 0;
  }

  return prev[b.length] ?? limit + 1;
}

/**
 * 判断 candidate 是否像 existing 的变形。
 *
 * 规格原文是「编辑距离 ≤ 1 且词根相同」。但 `run` / `running` 的编辑距离是 4，
 * 按字面实现就永远提示不到 —— 而规格的测试清单里明确要求 run/running 要触发。
 * 所以判定拆成两条并列条件（都要求词根相同）：
 *   a) 词根相同且其中一个就是另一个加后缀 → 触发
 *   b) 词根相同且编辑距离 ≤ 1 → 触发
 * `cat` / `cut` 因为词根不同（cat vs cut），两条都不成立。
 */
export function looksSimilar(candidate: string, existing: string): boolean {
  const a = candidate.toLowerCase();
  const b = existing.toLowerCase();
  if (a === b) return false;
  if (stemOf(a) !== stemOf(b)) return false;

  // a) 加后缀的关系：run → running / runs，abandon → abandoned
  if (a.startsWith(b) || b.startsWith(a)) return true;

  // b) 拼写接近
  return editDistance(a, b, 1) <= 1;
}

/**
 * 在一批已存在的词里找疑似重复。
 * 返回第一个命中的已存在 norm（找不到返回 null）。
 */
export function findSimilar(
  candidateNorm: string,
  existingNorms: Iterable<string>,
): string | null {
  for (const existing of existingNorms) {
    if (looksSimilar(candidateNorm, existing)) return existing;
  }
  return null;
}
