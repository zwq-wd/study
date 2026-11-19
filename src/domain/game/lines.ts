/**
 * 游戏模式 · 台词挑选（纯函数）
 *
 * 台词本身放在 src/ui/i18n.ts（全应用的文案都在那儿），这里只负责「挑哪一句」。
 * 抽出纯函数的理由和 hunger.ts 一样：可单测、零随机源依赖 ——
 * rng 由调用方传入，测试固定 0 就能复现。
 *
 * 规则：优先挑最近没用过的；全用过了就从最久没用的那批里挑。
 */

export interface LinePick {
  /** 挑中的台词 */
  text: string;
  /** 更新后的「最近用过」窗口，调用方原样存回去 */
  recent: number[];
}

/**
 * 从一组台词里挑一句。
 *
 * @param lines  候选台词（空数组时返回空串，调用方据此不显示气泡）
 * @param recent 最近说过的下标（长度即窗口大小）
 * @param rng    0..1 的随机源
 */
export function pickLine(
  lines: readonly string[],
  recent: readonly number[],
  rng: () => number = Math.random,
  window = 4,
): LinePick {
  if (lines.length === 0) return { text: "", recent: [...recent] };

  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!recent.includes(i)) candidates.push(i);
  }
  // 全都在窗口里（台词比窗口还少）：退回全集，宁可重复一句也别不说话
  const pool = candidates.length > 0 ? candidates : lines.map((_, i) => i);

  const raw = rng();
  const safe = Number.isFinite(raw) ? Math.min(0.999999, Math.max(0, raw)) : 0;
  const index = pool[Math.floor(safe * pool.length)] ?? pool[0] ?? 0;

  return {
    text: lines[index] ?? "",
    recent: [...recent, index].slice(-Math.max(1, window)),
  };
}

/**
 * 按「这一碗打到了第几个」挑一句进度台词。
 *
 * 每格都有话说：1/5 到 4/5 一直在报进度，满碗时说的是另一套。
 * 台词比格数少时回到第一句，保证任何格数都有话。
 */
export function bowlProgressLine(lines: readonly string[], filled: number): string {
  if (lines.length === 0) return "";
  const idx = Math.min(lines.length - 1, Math.max(0, filled - 1));
  return lines[idx] ?? "";
}
